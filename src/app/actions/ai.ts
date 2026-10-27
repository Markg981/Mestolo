'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser, getProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveProvider, recordUsage, type KeySource } from '@/lib/ai/service';
import { withRefund } from '@/lib/ai/refund';
import { analyzeSystem, analyzeUserPrompt, substituteSystem, substituteUserPrompt, translateSystem } from '@/lib/ai/prompts';
import { analysisSchema, applySuggestions, type Analysis } from '@/lib/recipes/suggestions';
import { findBuiltinSubstitutions, substitutionResultSchema, type SubstitutionResult } from '@/lib/recipes/substitutions';
import { buildTranslatable, guardTranslatedNumbers, isTranslationFresh, mergeTranslation, translatedPayloadSchema, TranslationShapeError } from '@/lib/recipes/translation';
import { isLocale } from '@/i18n/config';
import type { RecipeContent, RecipeRow } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

function contentOf(r: RecipeRow): RecipeContent {
  return {
    title: r.title,
    description: r.description,
    original_language: r.original_language,
    servings: r.servings === null ? null : Number(r.servings),
    prep_minutes: r.prep_minutes,
    cook_minutes: r.cook_minutes,
    total_minutes: r.total_minutes,
    ingredients: r.ingredients ?? [],
    steps: r.steps ?? [],
    category_id: r.category_id,
    tags: r.tags ?? [],
  };
}

async function uiLocale() {
  const p = await getProfile();
  return p?.locale ?? 'it';
}

export type AnalysisResponse = { analysisId: string; analysis: Analysis; keySource: KeySource; providerName: string };

export async function analyzeRecipe(recipeId: string): Promise<ActionResult<AnalysisResponse>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
    if (!data) return fail('not_found');
    const r = data as RecipeRow;
    await enforceRateLimit('ai_text', user.id);
    const resolved = await resolveProvider(user.id, 'text', 'text', 'analyze');
    return await withRefund(user.id, resolved, 'text', 'analyze', async (paid) => {
      const raw = await resolved.provider.completeJson({ system: analyzeSystem(await uiLocale()), user: analyzeUserPrompt(contentOf(r)), maxTokens: 4000 });
      paid();
      await recordUsage(user.id, 'text', 'analyze', resolved);
      const parsed = analysisSchema.safeParse(raw);
      if (!parsed.success) return fail('ai_bad_output');
      // Drop suggestions that point outside the recipe
      const analysis: Analysis = {
        summary: parsed.data.summary,
        suggestions: parsed.data.suggestions.filter((s) =>
          s.type === 'step_rewrite' ? s.stepIndex < r.steps.length : s.type === 'ingredient_fix' ? s.ingredientIndex < r.ingredients.length : true,
        ),
      };
      const { data: row, error } = await createAdminClient()
        .from('ai_suggestions')
        .insert({ recipe_id: r.id, user_id: user.id, kind: 'analysis', payload: analysis, recipe_hash: r.content_hash, provider: resolved.provider.id, key_source: resolved.keySource })
        .select('id')
        .single();
      if (error) return dbFailure(error, 'analyzeRecipe.store');
      return ok({ analysisId: row.id as string, analysis, keySource: resolved.keySource, providerName: resolved.providerName });
    });
  } catch (e) {
    return toFailure(e, 'analyzeRecipe');
  }
}

/**
 * mode "apply": updates the recipe with ONLY the selected suggestions (a new version is recorded; the original stays in history)
 * mode "variant": saves a separate private recipe linked to the original, which is left untouched
 */
export async function applyAnalysis(
  recipeId: string,
  analysisId: string,
  selectedIds: string[],
  mode: 'apply' | 'variant',
  variantSuffix = '',
): Promise<ActionResult<{ id: string; applied: number; skipped: number }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success || !uuid.safeParse(analysisId).success) return fail('forbidden');
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 50) return fail('invalid_input');
    const supabase = await createClient();
    const [{ data: rec }, { data: sug }] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', recipeId).eq('owner_id', user.id).maybeSingle(),
      supabase.from('ai_suggestions').select('payload, recipe_hash').eq('id', analysisId).eq('recipe_id', recipeId).eq('kind', 'analysis').maybeSingle(),
    ]);
    if (!rec || !sug) return fail('not_found');
    const r = rec as RecipeRow;
    // analisi superata: la ricetta è cambiata dopo l'analisi
    if (sug.recipe_hash !== r.content_hash) return fail('invalid_input', 'stale');
    const parsedAnalysis = analysisSchema.safeParse(sug.payload);
    if (!parsedAnalysis.success) return fail('ai_bad_output');
    const analysis = parsedAnalysis.data;
    const result = applySuggestions(contentOf(r), r.field_flags ?? {}, analysis.suggestions, selectedIds.map(String));
    if (!result.applied.length) return fail('invalid_input', 'stale');
    const c = result.content;
    const fields = {
      title: c.title,
      description: c.description,
      servings: c.servings,
      prep_minutes: c.prep_minutes,
      cook_minutes: c.cook_minutes,
      total_minutes: c.total_minutes,
      ingredients: c.ingredients,
      steps: c.steps,
      field_flags: result.fieldFlags,
    };
    if (mode === 'apply') {
      // concorrenza ottimistica: aggiorna solo se il contenuto e' ancora quello analizzato
      const { data: updated, error } = await supabase
        .from('recipes')
        .update({ ...fields, last_change_source: 'ai_suggestions', last_change_note: `${result.applied.length}` })
        .eq('id', recipeId)
        .eq('owner_id', user.id)
        .eq('content_hash', r.content_hash)
        .select('id');
      if (error) return dbFailure(error, 'applyAnalysis.update');
      if (!updated?.length) return fail('conflict');
      revalidatePath(`/recipes/${recipeId}`);
      return ok({ id: recipeId, applied: result.applied.length, skipped: result.skipped.length });
    }
    const { data: v, error } = await supabase
      .from('recipes')
      .insert({
        ...fields,
        owner_id: user.id,
        title: `${c.title}${variantSuffix ? ` ${variantSuffix}` : ''}`.slice(0, 200),
        original_language: r.original_language,
        category_id: r.category_id,
        tags: r.tags,
        visibility: 'private',
        source_type: 'variant',
        parent_recipe_id: r.id,
        source_url: r.source_url,
        source_name: r.source_name,
        source_attribution: r.source_attribution,
        verification_status: r.verification_status,
        last_change_source: 'ai_suggestions',
        last_change_note: `${result.applied.length}`,
      })
      .select('id')
      .single();
    if (error) return dbFailure(error, 'applyAnalysis.variant');
    revalidatePath('/recipes');
    return ok({ id: v.id as string, applied: result.applied.length, skipped: result.skipped.length });
  } catch (e) {
    return toFailure(e, 'applyAnalysis');
  }
}

export type SubstitutionResponse = {
  builtin: { ingredient: string; alternatives: ReturnType<typeof findBuiltinSubstitutions> }[];
  ai: SubstitutionResult | null;
  aiSource: { keySource: KeySource; providerName: string } | null;
};

/** Substitutions for missing ingredients: built-in table (free) + optional AI. Always presented as suggestions. */
export async function suggestSubstitutions(recipeId: string, missing: string[], useAi: boolean): Promise<ActionResult<SubstitutionResponse>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    const list = z.array(z.string().trim().min(1).max(200)).min(1).max(15).safeParse(missing);
    if (!list.success) return fail('invalid_input');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(); // RLS: must be visible
    if (!data) return fail('not_found');
    const locale = await uiLocale();
    const builtin = list.data.map((name) => ({ ingredient: name, alternatives: findBuiltinSubstitutions(name, locale) }));
    if (!useAi) return ok({ builtin, ai: null, aiSource: null });

    await enforceRateLimit('ai_text', user.id);
    const resolved = await resolveProvider(user.id, 'text', 'text', 'substitute');
    return await withRefund(user.id, resolved, 'text', 'substitute', async (paid) => {
      const raw = await resolved.provider.completeJson({ system: substituteSystem(locale), user: substituteUserPrompt(contentOf(data as RecipeRow), list.data), maxTokens: 3000 });
      paid();
      await recordUsage(user.id, 'text', 'substitute', resolved);
      const parsed = substitutionResultSchema.safeParse(raw);
      if (!parsed.success) return fail('ai_bad_output');
      await createAdminClient()
        .from('ai_suggestions')
        .insert({ recipe_id: recipeId, user_id: user.id, kind: 'substitution', payload: { missing: list.data, result: parsed.data }, recipe_hash: (data as RecipeRow).content_hash, provider: resolved.provider.id, key_source: resolved.keySource });
      return ok({ builtin, ai: parsed.data, aiSource: { keySource: resolved.keySource, providerName: resolved.providerName } });
    });
  } catch (e) {
    return toFailure(e, 'suggestSubstitutions');
  }
}

/**
 * Translates a visible recipe and caches the result (shared by all viewers),
 * tied to the content hash: if the original changes, the cache is ignored.
 * The original is never modified.
 */
export async function translateRecipe(recipeId: string, target: string): Promise<ActionResult<{ cached: boolean }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success || !isLocale(target)) return fail('invalid_input');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(); // RLS
    if (!data) return fail('not_found');
    const r = data as RecipeRow;
    if (r.original_language.slice(0, 2) === target) return ok({ cached: true });

    const { data: cached } = await supabase.from('recipe_translations').select('source_hash').eq('recipe_id', recipeId).eq('locale', target).maybeSingle();
    if (cached && isTranslationFresh(cached.source_hash, r.content_hash)) return ok({ cached: true });

    // L-14: claim atomico per (ricetta, lingua): una sola richiesta chiama il provider.
    const admin = createAdminClient();
    const { data: claimed, error: claimError } = await admin.rpc('claim_translation_lock', { p_recipe: recipeId, p_locale: target });
    if (claimError) return dbFailure(claimError, 'translateRecipe.claim');
    if (!claimed) return fail('conflict'); // traduzione gia in corso: il client riprova/ricarica
    try {
    await enforceRateLimit('ai_translate', user.id);
    const resolved = await resolveProvider(user.id, 'text', 'translate', 'recipe');
    return await withRefund(user.id, resolved, 'translate', 'recipe', async (paid) => {
      const payload = buildTranslatable(r);
      const raw = await resolved.provider.completeJson({ system: translateSystem(r.original_language, target), user: JSON.stringify(payload), maxTokens: 6000 });
      paid();
      await recordUsage(user.id, 'translate', 'recipe', resolved);
      const parsed = translatedPayloadSchema.safeParse(raw);
      if (!parsed.success) return fail('translation_failed');
      try {
        mergeTranslation(r, parsed.data); // validates the structure
      } catch (e) {
        if (e instanceof TranslationShapeError) return fail('translation_failed');
        throw e;
      }
      const { error } = await createAdminClient()
        .from('recipe_translations')
        .upsert({ recipe_id: recipeId, locale: target, content: guardTranslatedNumbers(r, parsed.data), source_hash: r.content_hash, provider: resolved.provider.id, created_at: new Date().toISOString() });
      if (error) return dbFailure(error, 'translateRecipe.store');
      revalidatePath(`/recipes/${recipeId}`);
      return ok({ cached: false });
    });
    } finally {
      // pulizia anche su errore; se fallisce, il TTL libera comunque il lock
      await admin.rpc('release_translation_lock', { p_recipe: recipeId, p_locale: target }).then(undefined, () => undefined);
    }
  } catch (e) {
    return toFailure(e, 'translateRecipe');
  }
}
