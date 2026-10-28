'use server';

import { validateNutrition } from '@/lib/nutrition';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { cleanEditorPayload, effectiveVerificationStatus, recipeInputSchema } from '@/lib/recipes/schema';
import type { DuplicateMatch } from '@/lib/recipes/duplicates';
import { VISIBILITIES, type Ingredient, type RecipeRow } from '@/lib/recipes/types';
import { invalidatePublicPage } from '@/lib/data/public-invalidation';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

/** Creates or updates a recipe. The editor never changes a recipe silently: every save is a new version. */
/**
 * `expectedVersion` (required when updating) is the recipe version read when the editor was opened: if the row moved on in the
 * meantime (another tab or device saved), nothing is overwritten and the result is 'conflict'.
 * `idempotencyKey` (creation only): a client-generated UUID; a repeated submit with the same key returns the recipe already created.
 */
export async function saveRecipe(payload: unknown, recipeId?: string | null, expectedVersion?: number | null, idempotencyKey?: string | null): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const parsed = recipeInputSchema.safeParse(cleanEditorPayload(payload));
    if (!parsed.success) return fail('invalid_input', parsed.error.issues[0]?.path.join('.'));
    const d = parsed.data;
    const supabase = await createClient();

    const content = {
      title: d.title,
      description: d.description,
      original_language: d.original_language,
      servings: d.servings,
      prep_minutes: d.prep_minutes,
      cook_minutes: d.cook_minutes,
      total_minutes: d.total_minutes,
      ingredients: d.ingredients,
      steps: d.steps,
      category_id: d.category_id,
      tags: d.tags,
      visibility: d.visibility,
      field_flags: d.field_flags,
      verification_status: effectiveVerificationStatus(d),
      diet_hints: d.diet_hints,
    };

    let id = recipeId ?? null;
    let created = false;
    if (id) {
      // update senza versione attesa = ultima scrittura vince: non ammesso
      if (!uuid.safeParse(id).success || !Number.isInteger(expectedVersion)) return fail('invalid_input');
      let q = supabase
        .from('recipes')
        .update({ ...content, last_change_source: 'edit' })
        .eq('id', id)
        .eq('owner_id', user.id);
      q = q.eq('version', expectedVersion as number);
      const { data, error } = await q.select('id, public_slug').maybeSingle();
      if (error) return dbFailure(error, 'saveRecipe.update');
      if (!data) {
        // 0 righe: la ricetta non esiste piu' oppure la versione e' cambiata
        const { data: cur } = await supabase.from('recipes').select('id').eq('id', id).eq('owner_id', user.id).maybeSingle();
        if (cur) return fail('conflict');
        return fail('not_found');
      }
      invalidatePublicPage(data.public_slug as string | null);
    } else {
      const key = idempotencyKey && uuid.safeParse(idempotencyKey).success ? idempotencyKey : null;
      const existingByKey = async () => {
        if (!key) return null;
        const { data: ex } = await supabase.from('recipes').select('id').eq('owner_id', user.id).eq('idempotency_key', key).maybeSingle();
        return (ex?.id as string | undefined) ?? null;
      };
      const already = await existingByKey();
      if (already) return ok({ id: already });
      await enforceRateLimit('recipe_create', user.id);
      await enforceRateLimit('recipe_create_day', user.id);
      const { data, error } = await supabase
        .from('recipes')
        .insert({
          ...content,
          idempotency_key: key,
          owner_id: user.id,
          source_type: d.source_type,
          source_url: d.source_url,
          source_name: d.source_name,
          source_attribution: d.source_attribution,
          last_change_source: d.source_type === 'manual' ? 'create' : 'import',
        })
        .select('id')
        .single();
      if (error) {
        // doppio invio concorrente: l'altra richiesta ha vinto sulla chiave univoca
        if (error.code === '23505') {
          const dup = await existingByKey();
          if (dup) return ok({ id: dup });
        }
        return dbFailure(error, 'saveRecipe.insert');
      }
      id = data.id as string;
      // Valori nutrizionali trovati dall'import (schema.org): rivalidati qui, fonte sempre 'imported'.
      const imported = validateNutrition((payload as { nutrition?: unknown } | null)?.nutrition);
      if (d.source_type === 'url' && imported.ok) {
        const { error: nErr } = await supabase.from('recipe_nutrition').upsert({ recipe_id: id, ...imported.values, source: 'imported' });
        if (nErr) {
          // Compensazione: la ricetta appena creata non deve restare a meta (un retry idempotente la restituirebbe senza nutrizione).
          await supabase.from('recipes').delete().eq('id', id).eq('owner_id', user.id);
          return dbFailure(nErr, 'saveRecipe.nutrition');
        }
      }
      created = true;
    }

    if (d.personal_note !== undefined) {
      const { error: noteErr } = d.personal_note.trim()
        ? await supabase.from('recipe_notes').upsert({ recipe_id: id, owner_id: user.id, body: d.personal_note })
        : await supabase.from('recipe_notes').delete().eq('recipe_id', id).eq('owner_id', user.id);
      if (noteErr) {
        // In creazione compensa eliminando la ricetta; in modifica il salvataggio non va dichiarato riuscito.
        if (created) await supabase.from('recipes').delete().eq('id', id).eq('owner_id', user.id);
        return dbFailure(noteErr, 'saveRecipe.note');
      }
    }
    revalidatePath('/recipes');
    revalidatePath(`/recipes/${id}`);
    return ok({ id: id! });
  } catch (e) {
    return toFailure(e, 'saveRecipe');
  }
}

export async function saveNote(recipeId: string, body: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
  if (body.length > 10000) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = body.trim()
    ? await supabase.from('recipe_notes').upsert({ recipe_id: recipeId, owner_id: user.id, body })
    : await supabase.from('recipe_notes').delete().eq('recipe_id', recipeId).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'saveNote');
  revalidatePath(`/recipes/${recipeId}`);
  return ok();
}

export async function deleteRecipe(recipeId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
  const supabase = await createClient();
  const { data: pub } = await supabase.from('recipes').select('public_slug').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
  const { data: imgs } = await supabase.from('recipe_images').select('storage_path, thumb_path').eq('recipe_id', recipeId).eq('owner_id', user.id);
  const paths = ((imgs as { storage_path: string; thumb_path: string | null }[]) ?? []).flatMap((i) => [i.storage_path, i.thumb_path].filter(Boolean) as string[]);
  const { data, error } = await supabase.from('recipes').delete().eq('id', recipeId).eq('owner_id', user.id).select('id');
  if (error) return dbFailure(error, 'deleteRecipe');
  if (!data?.length) return fail('not_found');
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from('recipe-images').remove(paths);
    // Non blocca l'operazione: i file orfani vengono ripuliti dal cron di cleanup.
    if (rmErr) console.error(`[mestolo] deleteRecipe: storage.remove fallito recipe=${recipeId} paths=${paths.length}`);
  }
  invalidatePublicPage(pub?.public_slug as string | null | undefined);
  revalidatePath('/recipes');
  return ok();
}

export async function setVisibility(recipeId: string, visibility: string): Promise<ActionResult> {
  const user = await getUser();
  const v = z.enum(VISIBILITIES).safeParse(visibility);
  if (!user || !v.success || !uuid.safeParse(recipeId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('recipes').update({ visibility: v.data }).eq('id', recipeId).eq('owner_id', user.id).select('id, public_slug');
  if (error) return dbFailure(error, 'setVisibility');
  if (!data?.length) return fail('not_found');
  invalidatePublicPage(data[0].public_slug as string | null);
  revalidatePath(`/recipes/${recipeId}`);
  return ok();
}

/**
 * Opt-in to an indexable public page (/r/<slug>) for one recipe. The database accepts it
 * only while the recipe is public; the slug is assigned by the database and never changes.
 */
export async function setPublicPage(recipeId: string, enabled: boolean): Promise<ActionResult<{ slug: string | null }>> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success || typeof enabled !== 'boolean') return fail('invalid_input');
  const supabase = await createClient();
  const { data: cur } = await supabase.from('recipes').select('visibility').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
  if (!cur) return fail('not_found');
  if (enabled && cur.visibility !== 'public') return fail('invalid_input');
  const { data, error } = await supabase
    .from('recipes')
    .update({ public_page_enabled: enabled })
    .eq('id', recipeId)
    .eq('owner_id', user.id)
    .select('public_slug, public_page_enabled');
  if (error) return dbFailure(error, 'setPublicPage');
  if (!data?.length) return fail('not_found');
  const slug = (data[0].public_slug as string | null) ?? null;
  invalidatePublicPage(slug);
  revalidatePath(`/recipes/${recipeId}`);
  return ok({ slug });
}

export async function toggleFavorite(recipeId: string, favorite: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
  const supabase = await createClient();
  const { error } = favorite
    ? await supabase.from('favorites').upsert({ user_id: user.id, recipe_id: recipeId }, { onConflict: 'user_id,recipe_id', ignoreDuplicates: true })
    : await supabase.from('favorites').delete().eq('user_id', user.id).eq('recipe_id', recipeId);
  if (error) return dbFailure(error, 'toggleFavorite');
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath('/recipes');
  return ok();
}

/**
 * Saves a recipe the user can see into their own recipe book.
 * mode "copy": independent private copy with author attribution.
 * mode "variant": like a copy, but linked to the original as its parent.
 * Images of other people are not copied (rights belong to their owner).
 */
export async function copyRecipe(sourceId: string, mode: 'copy' | 'variant', titleSuffix = ''): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(sourceId).success) return fail('forbidden');
    await enforceRateLimit('recipe_create', user.id);
    await enforceRateLimit('recipe_create_day', user.id);
    const supabase = await createClient();
    const { data: src } = await supabase.from('recipes').select('*').eq('id', sourceId).maybeSingle();
    if (!src) return fail('not_found');
    const s = src as RecipeRow;
    const own = s.owner_id === user.id;
    const { data, error } = await supabase
      .from('recipes')
      .insert({
        owner_id: user.id,
        title: `${s.title}${titleSuffix ? ` ${titleSuffix}` : ''}`.slice(0, 200),
        description: s.description,
        original_language: s.original_language,
        servings: s.servings,
        prep_minutes: s.prep_minutes,
        cook_minutes: s.cook_minutes,
        total_minutes: s.total_minutes,
        ingredients: s.ingredients,
        steps: s.steps,
        category_id: own ? s.category_id : null,
        tags: s.tags,
        visibility: 'private',
        field_flags: s.field_flags,
        verification_status: s.verification_status,
        source_type: mode === 'variant' ? 'variant' : 'copy',
        source_url: s.source_url,
        source_name: s.source_name,
        source_attribution: s.source_attribution,
        parent_recipe_id: mode === 'variant' ? s.id : null,
        // Copia di una propria ricetta: eredita la catena di attribuzione della sorgente invece di azzerarla.
        copied_from_recipe_id: own ? s.copied_from_recipe_id : s.id,
        original_author_id: own ? s.original_author_id : (s.original_author_id ?? s.owner_id),
        last_change_source: 'copy',
      })
      .select('id')
      .single();
    if (error) return dbFailure(error, 'copyRecipe');
    revalidatePath('/recipes');
    return ok({ id: data.id as string });
  } catch (e) {
    return toFailure(e, 'copyRecipe');
  }
}

/**
 * Ripristina lo snapshot di una versione. `expectedVersion` e' la versione corrente vista dal client:
 * se la ricetta e' cambiata nel frattempo (altra scheda o dispositivo) non si sovrascrive nulla e il risultato e' 'conflict'.
 */
export async function restoreVersion(recipeId: string, version: number, expectedVersion: number): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success || !Number.isInteger(version) || !Number.isInteger(expectedVersion)) return fail('invalid_input');
  const supabase = await createClient();
  const { data: v } = await supabase.from('recipe_versions').select('snapshot').eq('recipe_id', recipeId).eq('version', version).maybeSingle();
  if (!v) return fail('not_found');
  const s = v.snapshot as Record<string, unknown>;
  const { data: before } = await supabase.from('recipes').select('public_slug').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
  const { data, error } = await supabase
    .from('recipes')
    .update({
      title: s.title,
      description: s.description,
      original_language: s.original_language,
      servings: s.servings,
      prep_minutes: s.prep_minutes,
      cook_minutes: s.cook_minutes,
      total_minutes: s.total_minutes,
      ingredients: s.ingredients,
      steps: s.steps,
      category_id: s.category_id,
      tags: s.tags,
      last_change_source: 'restore',
      last_change_note: `v${version}`,
    })
    .eq('id', recipeId)
    .eq('owner_id', user.id)
    .eq('version', expectedVersion)
    .select('id, public_slug');
  if (error) return dbFailure(error, 'restoreVersion');
  if (!data?.length) {
    const { data: cur } = await supabase.from('recipes').select('id').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
    return fail(cur ? 'conflict' : 'not_found');
  }
  // La pagina pubblica e' in cache: vecchio e nuovo slug (se cambia) mostrerebbero il contenuto precedente al ripristino
  invalidatePublicPage(before?.public_slug as string | null | undefined);
  const newSlug = (data[0] as { public_slug?: string | null }).public_slug;
  if (newSlug && newSlug !== before?.public_slug) invalidatePublicPage(newSlug);
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath(`/recipes/${recipeId}/history`);
  return ok();
}

export async function checkDuplicates(draft: { title: string; source_url?: string | null; ingredients?: Pick<Ingredient, 'name'>[] }, excludeId?: string): Promise<DuplicateMatch[]> {
  const user = await getUser();
  if (!user || !draft?.title) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('find_possible_duplicates', {
    p_title: String(draft.title).slice(0, 200),
    p_source_url: draft.source_url ?? null,
    p_ingredients: (draft.ingredients ?? []).map((i) => String(i.name ?? '')).slice(0, 200),
    p_exclude_id: excludeId ?? null,
  });
  return (data as DuplicateMatch[] | null) ?? [];
}
