import 'server-only';
import { unstable_cache } from 'next/cache';
import { createClient as createAnon } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { createTimeoutFetch } from '@/lib/supabase/fetch';
import { createClient } from '@/lib/supabase/server';
import { PUBLIC_RECIPES_TAG, publicRecipeTag } from '@/lib/data/public-recipes';
import { isNutritionSource, NUTRIENT_KEYS, type RecipeNutrition } from '@/lib/nutrition';
import { isValidSlug } from '@/lib/recipes/slug';

function toNutrition(row: Record<string, unknown> | null | undefined): RecipeNutrition | null {
  if (!row || !isNutritionSource(row.source)) return null;
  const out = { source: row.source, updated_at: String(row.updated_at) } as RecipeNutrition;
  for (const k of NUTRIENT_KEYS) out[k] = row[k] === null || row[k] === undefined ? null : Number(row[k]);
  return out;
}

/** Nutrition of a recipe visible to the current user (RLS: same visibility as the recipe). */
export async function getRecipeNutrition(recipeId: string): Promise<RecipeNutrition | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('recipe_nutrition').select('*').eq('recipe_id', recipeId).maybeSingle();
  return toNutrition(data as Record<string, unknown> | null);
}

/** Anonymous read for /r/[slug] through the SECURITY DEFINER function; cached with the public page tags. */
export function getPublicRecipeNutrition(slug: string): Promise<RecipeNutrition | null> {
  if (!isValidSlug(slug)) return Promise.resolve(null);
  return unstable_cache(
    async () => {
      const { supabaseUrl, supabaseAnonKey } = env();
      const anon = createAnon(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createTimeoutFetch() } });
      const { data, error } = await anon.rpc('get_public_recipe_nutrition', { p_slug: slug }).maybeSingle();
      if (error) throw error;
      return toNutrition(data as Record<string, unknown> | null);
    },
    ['public-recipe-nutrition', slug],
    { tags: [PUBLIC_RECIPES_TAG, publicRecipeTag(slug)], revalidate: 3600 },
  )();
}
