'use server';

import { revalidatePath } from 'next/cache';
import { invalidatePublicPageForRecipe } from '@/lib/data/public-invalidation';
import { z } from 'zod';
import { createClient, getUser, getProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveProvider, recordUsage, type KeySource } from '@/lib/ai/service';
import { withRefund } from '@/lib/ai/refund';
import { analyzeSystem, analyzeUserPrompt, pairingSystem, pairingUserPrompt, substituteSystem, substituteUserPrompt, translateSystem, translateUserPrompt } from '@/lib/ai/prompts';
import { finalizePairing, pairingAiSchema, type PairingAssessment } from '@/lib/recipes/pairing';
import { aiIngredientSchema, analysisSchema, applySuggestions, type Analysis } from '@/lib/recipes/suggestions';
import { parseIngredientLine } from '@/lib/recipes/ingredient-parser';
import { findBuiltinSubstitutions, substitutionResultSchema, type SubstitutionResult } from '@/lib/recipes/substitutions';
import { buildTranslatable, guardTranslatedNumbers, isTranslationFresh, mergeTranslation, translatedPayloadSchema, TranslationShapeError } from '@/lib/recipes/translation';
import { isLocale } from '@/i18n/config';
import type { RecipeContent, RecipeRow } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult, type ErrorCode } from './_utils';

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
      await invalidatePublicPageForRecipe(supabase, recipeId);
      return ok({ id: recipeId, applied: result.applied.length, skipped: result.skipped.length });
    }
    const v = await insertVariant(supabase, user.id, r, fields, variantSuffix, `${result.applied.length}`);
    if (!v.ok) return dbFailure(v.error, 'applyAnalysis.variant');
    revalidatePath('/recipes');
    return ok({ id: v.id, applied: result.applied.length, skipped: result.skipped.length });
  } catch (e) {
    return toFailure(e, 'applyAnalysis');
  }
}

/** Separate private recipe linked to the original, which is left untouched. */
async function insertVariant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  r: RecipeRow,
  fields: Pick<RecipeRow, 'title' | 'description' | 'servings' | 'prep_minutes' | 'cook_minutes' | 'total_minutes' | 'ingredients' | 'steps' | 'field_flags'>,
  variantSuffix: string,
  changeNote: string,
) {
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      ...fields,
      owner_id: userId,
      title: `${fields.title}${variantSuffix ? ` ${variantSuffix}` : ''}`.slice(0, 200),
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
      last_change_note: changeNote,
    })
    .select('id')
    .single();
  return error ? ({ ok: false, error } as const) : ({ ok: true, id: data.id as string } as const);
}

export type SubstitutionResponse = {
  builtin: { ingredient: string; alternatives: ReturnType<typeof findBuiltinSubstitutions> }[];
  ai: SubstitutionResult | null;
  aiSource: { keySource: KeySource; providerName: string } | null;
  /** AI requested but failed: the built-in suggestions are still returned. */
  aiError?: ErrorCode;
};

/** Substitutions for missing ingredients: built-in table (free) + optional AI. Always presented as suggestions. */
export async function suggestSubstitutions(recipeId: string, missing: string[], useAi: boolean): Promise<ActionResult<SubstitutionResponse>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    const list = z
      .array(z.string().trim().min(1).max(200))
      .max(30)
      .transform((xs) => xs.filter((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i))
      .pipe(z.array(z.string()).min(1).max(15))
      .safeParse(missing);
    if (!list.success) return fail('invalid_input');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(); // RLS: must be visible
    if (!data) return fail('not_found');
    const locale = await uiLocale();
    const builtin = list.data.map((name) => ({ ingredient: name, alternatives: findBuiltinSubstitutions(name, locale) }));
    if (!useAi) return ok({ builtin, ai: null, aiSource: null });

    // Un errore AI (quota, provider, rate limit) non deve far perdere i suggerimenti integrati.
    const withoutAi = (aiError: ErrorCode) => ok<SubstitutionResponse>({ builtin, ai: null, aiSource: null, aiError });
    try {
      await enforceRateLimit('ai_text', user.id);
      const resolved = await resolveProvider(user.id, 'text', 'text', 'substitute');
      const res = await withRefund(user.id, resolved, 'text', 'substitute', async (paid): Promise<ActionResult<SubstitutionResponse>> => {
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
      return res.ok ? res : withoutAi(res.error);
    } catch (e) {
      return withoutAi(toFailure(e, 'suggestSubstitutions.ai').error);
    }
  } catch (e) {
    return toFailure(e, 'suggestSubstitutions');
  }
}

export type PairingResponse = { pairingId: string; assessment: PairingAssessment; aiSource: { keySource: KeySource; providerName: string } };

/** Compatibility of one extra ingredient with a visible recipe (AI only). Always presented as an estimate. */
export async function checkIngredientPairing(recipeId: string, addition: string): Promise<ActionResult<PairingResponse>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    const text = z.string().trim().min(1).max(200).safeParse(addition);
    if (!text.success) return fail('invalid_input');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(); // RLS: must be visible
    if (!data) return fail('not_found');
    const r = data as RecipeRow;
    const locale = await uiLocale();
    await enforceRateLimit('ai_text', user.id);
    const resolved = await resolveProvider(user.id, 'text', 'text', 'pairing');
    return await withRefund(user.id, resolved, 'text', 'pairing', async (paid) => {
      const raw = await resolved.provider.completeJson({ system: pairingSystem(locale), user: pairingUserPrompt(contentOf(r), text.data), maxTokens: 2000 });
      paid();
      await recordUsage(user.id, 'text', 'pairing', resolved);
      const parsed = pairingAiSchema.safeParse(raw);
      if (!parsed.success) return fail('ai_bad_output');
      const assessment = finalizePairing(parsed.data, { ingredients: (r.ingredients ?? []).length, steps: (r.steps ?? []).length });
      if (assessment === 'not_food') return fail('invalid_input', 'not_food');
      if (!assessment) return fail('ai_bad_output');
      const { data: row, error } = await createAdminClient()
        .from('ai_suggestions')
        .insert({ recipe_id: recipeId, user_id: user.id, kind: 'pairing', payload: { addition: text.data, result: assessment }, recipe_hash: r.content_hash, provider: resolved.provider.id, key_source: resolved.keySource })
        .select('id')
        .single();
      if (error) return dbFailure(error, 'checkIngredientPairing.store');
      return ok({ pairingId: row.id as string, assessment, aiSource: { keySource: resolved.keySource, providerName: resolved.providerName } });
    });
  } catch (e) {
    return toFailure(e, 'checkIngredientPairing');
  }
}

/** Saves a private variant of the recipe with the evaluated ingredient added; the original is untouched. */
export async function saveVariantWithIngredient(recipeId: string, pairingId: string, variantSuffix = ''): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success || !uuid.safeParse(pairingId).success) return fail('forbidden');
    const supabase = await createClient();
    const [{ data: rec }, { data: sug }] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', recipeId).eq('owner_id', user.id).maybeSingle(),
      supabase.from('ai_suggestions').select('payload, recipe_hash').eq('id', pairingId).eq('recipe_id', recipeId).eq('kind', 'pairing').maybeSingle(),
    ]);
    if (!rec || !sug) return fail('not_found');
    const r = rec as RecipeRow;
    if (sug.recipe_hash !== r.content_hash) return fail('invalid_input', 'stale');
    const payload = z.object({ addition: z.string().min(1).max(200), result: z.object({ when_to_add: z.string().default('') }) }).safeParse(sug.payload);
    if (!payload.success) return fail('ai_bad_output');
    const line = parseIngredientLine(payload.data.addition);
    const add = aiIngredientSchema.safeParse({
      name: line.name || payload.data.addition,
      quantity: line.quantity,
      unit: line.unit,
      note: payload.data.result.when_to_add.slice(0, 300) || null,
    });
    if (!add.success) return fail('invalid_input');
    const result = applySuggestions(contentOf(r), r.field_flags ?? {}, [{ id: 'pairing', type: 'ingredient_add', after: add.data, reason: '' }], ['pairing']);
    if (!result.applied.length) return fail('invalid_input', 'duplicate');
    const c = result.content;
    const v = await insertVariant(
      supabase,
      user.id,
      r,
      { title: c.title, description: c.description, servings: c.servings, prep_minutes: c.prep_minutes, cook_minutes: c.cook_minutes, total_minutes: c.total_minutes, ingredients: c.ingredients, steps: c.steps, field_flags: result.fieldFlags },
      variantSuffix,
      '1',
    );
    if (!v.ok) return dbFailure(v.error, 'saveVariantWithIngredient');
    revalidatePath('/recipes');
    return ok({ id: v.id });
  } catch (e) {
    return toFailure(e, 'saveVariantWithIngredient');
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
      const raw = await resolved.provider.completeJson({ system: translateSystem(r.original_language, target), user: translateUserPrompt(JSON.stringify(payload)), maxTokens: 6000 });
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
      await invalidatePublicPageForRecipe(supabase, recipeId);
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
