'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveProvider, recordUsage, type KeySource } from '@/lib/ai/service';
import { NUTRITION_SYSTEM, nutritionUserPrompt } from '@/lib/ai/prompts';
import { parseAiNutrition, validateNutrition, type NutritionValues } from '@/lib/nutrition';
import { PUBLIC_RECIPES_TAG, publicRecipeTag } from '@/lib/data/public-recipes';
import type { RecipeRow } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

function refresh(recipeId: string, slug: string | null | undefined) {
  revalidatePath(`/recipes/${recipeId}`);
  if (slug) revalidateTag(publicRecipeTag(slug), 'max');
  revalidateTag(PUBLIC_RECIPES_TAG, 'max');
}

async function ownedRecipe(recipeId: string) {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
  return data ? { user, supabase, recipe: data as RecipeRow } : null;
}

/**
 * Saves the values chosen by the owner. The source is 'manual' unless the values are an AI estimate
 * left untouched by the user ('ai_estimate'). 'imported' is only ever set by the importer.
 */
export async function saveNutrition(recipeId: string, values: unknown, source: 'manual' | 'ai_estimate' = 'manual'): Promise<ActionResult> {
  try {
    const o = await ownedRecipe(recipeId);
    if (!o) return fail('not_found');
    if (source !== 'manual' && source !== 'ai_estimate') return fail('invalid_input');
    const v = validateNutrition(values);
    if (!v.ok) return fail('invalid_input', v.field);
    const { error } = await o.supabase.from('recipe_nutrition').upsert({ recipe_id: recipeId, ...v.values, source });
    if (error) return dbFailure(error, 'saveNutrition');
    refresh(recipeId, o.recipe.public_slug);
    return ok();
  } catch (e) {
    return toFailure(e, 'saveNutrition');
  }
}

export async function deleteNutrition(recipeId: string): Promise<ActionResult> {
  try {
    const o = await ownedRecipe(recipeId);
    if (!o) return fail('not_found');
    const { error } = await o.supabase.from('recipe_nutrition').delete().eq('recipe_id', recipeId);
    if (error) return dbFailure(error, 'deleteNutrition');
    refresh(recipeId, o.recipe.public_slug);
    return ok();
  } catch (e) {
    return toFailure(e, 'deleteNutrition');
  }
}

export type NutritionEstimate = { values: NutritionValues; keySource: KeySource; providerName: string };

/** Optional AI estimate. Returns a proposal only: nothing is saved until the owner confirms. */
export async function estimateNutrition(recipeId: string): Promise<ActionResult<NutritionEstimate>> {
  try {
    const o = await ownedRecipe(recipeId);
    if (!o) return fail('not_found');
    const r = o.recipe;
    if (!(r.ingredients ?? []).length) return fail('invalid_input', 'ingredients');
    await enforceRateLimit('ai_text', o.user.id);
    const resolved = await resolveProvider(o.user.id, 'text', 'text', 'nutrition');
    const raw = await resolved.provider.completeJson({
      system: NUTRITION_SYSTEM,
      user: nutritionUserPrompt({
        title: r.title,
        description: r.description,
        servings: r.servings === null ? null : Number(r.servings),
        prep_minutes: r.prep_minutes,
        cook_minutes: r.cook_minutes,
        total_minutes: r.total_minutes,
        ingredients: r.ingredients ?? [],
        steps: [],
      }),
      maxTokens: 600,
    });
    await recordUsage(o.user.id, 'text', 'nutrition', resolved);
    const values = parseAiNutrition(raw);
    if (!values) return fail('ai_bad_output');
    return ok({ values, keySource: resolved.keySource, providerName: resolved.providerName });
  } catch (e) {
    return toFailure(e, 'estimateNutrition');
  }
}
