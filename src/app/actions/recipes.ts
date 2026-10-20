'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { cleanEditorPayload, recipeInputSchema } from '@/lib/recipes/schema';
import { findPossibleDuplicates, type DuplicateMatch } from '@/lib/recipes/duplicates';
import { VISIBILITIES, type Ingredient, type RecipeRow } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

/** Creates or updates a recipe. The editor never changes a recipe silently: every save is a new version. */
export async function saveRecipe(payload: unknown, recipeId?: string | null): Promise<ActionResult<{ id: string }>> {
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
      verification_status: d.verification_status,
      diet_hints: d.diet_hints,
    };

    let id = recipeId ?? null;
    if (id) {
      if (!uuid.safeParse(id).success) return fail('invalid_input');
      const { data, error } = await supabase
        .from('recipes')
        .update({ ...content, last_change_source: 'edit' })
        .eq('id', id)
        .eq('owner_id', user.id)
        .select('id')
        .maybeSingle();
      if (error) return dbFailure(error, 'saveRecipe.update');
      if (!data) return fail('not_found');
    } else {
      const { data, error } = await supabase
        .from('recipes')
        .insert({
          ...content,
          owner_id: user.id,
          source_type: d.source_type,
          source_url: d.source_url,
          source_name: d.source_name,
          source_attribution: d.source_attribution,
          last_change_source: d.source_type === 'manual' ? 'create' : 'import',
        })
        .select('id')
        .single();
      if (error) return dbFailure(error, 'saveRecipe.insert');
      id = data.id as string;
    }

    if (d.personal_note !== undefined) {
      if (d.personal_note.trim()) {
        await supabase.from('recipe_notes').upsert({ recipe_id: id, owner_id: user.id, body: d.personal_note });
      } else {
        await supabase.from('recipe_notes').delete().eq('recipe_id', id).eq('owner_id', user.id);
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
  const { data: imgs } = await supabase.from('recipe_images').select('storage_path, thumb_path').eq('recipe_id', recipeId).eq('owner_id', user.id);
  const paths = ((imgs as { storage_path: string; thumb_path: string | null }[]) ?? []).flatMap((i) => [i.storage_path, i.thumb_path].filter(Boolean) as string[]);
  const { data, error } = await supabase.from('recipes').delete().eq('id', recipeId).eq('owner_id', user.id).select('id');
  if (error) return dbFailure(error, 'deleteRecipe');
  if (!data?.length) return fail('not_found');
  if (paths.length) await supabase.storage.from('recipe-images').remove(paths);
  revalidatePath('/recipes');
  return ok();
}

export async function setVisibility(recipeId: string, visibility: string): Promise<ActionResult> {
  const user = await getUser();
  const v = z.enum(VISIBILITIES).safeParse(visibility);
  if (!user || !v.success || !uuid.safeParse(recipeId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('recipes').update({ visibility: v.data }).eq('id', recipeId).eq('owner_id', user.id).select('id');
  if (error) return dbFailure(error, 'setVisibility');
  if (!data?.length) return fail('not_found');
  revalidatePath(`/recipes/${recipeId}`);
  return ok();
}

export async function toggleFavorite(recipeId: string, favorite: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
  const supabase = await createClient();
  const { error } = favorite
    ? await supabase.from('favorites').upsert({ user_id: user.id, recipe_id: recipeId })
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
    const supabase = await createClient();
    const { data: src } = await supabase.from('recipes').select('*').eq('id', sourceId).maybeSingle();
    if (!src) return fail('not_found');
    const s = src as RecipeRow;
    const own = s.owner_id === user.id;
    let authorName: string | null = s.original_author_name;
    if (!own && !authorName) {
      const { data: p } = await supabase.from('profiles').select('username').eq('id', s.owner_id).maybeSingle();
      authorName = p?.username ? `@${p.username}` : null;
    }
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
        copied_from_recipe_id: own ? null : s.id,
        original_author_id: own ? null : (s.original_author_id ?? s.owner_id),
        original_author_name: own ? null : authorName,
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

export async function restoreVersion(recipeId: string, version: number): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success || !Number.isInteger(version)) return fail('invalid_input');
  const supabase = await createClient();
  const { data: v } = await supabase.from('recipe_versions').select('snapshot').eq('recipe_id', recipeId).eq('version', version).maybeSingle();
  if (!v) return fail('not_found');
  const s = v.snapshot as Record<string, unknown>;
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
    .select('id');
  if (error) return dbFailure(error, 'restoreVersion');
  if (!data?.length) return fail('not_found');
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath(`/recipes/${recipeId}/history`);
  return ok();
}

export async function checkDuplicates(draft: { title: string; source_url?: string | null; ingredients?: Pick<Ingredient, 'name'>[] }, excludeId?: string): Promise<DuplicateMatch[]> {
  const user = await getUser();
  if (!user || !draft?.title) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('recipes').select('id, title, source_url, ingredients').eq('owner_id', user.id).limit(2000);
  const existing = ((data as { id: string; title: string; source_url: string | null; ingredients: Ingredient[] }[]) ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    source_url: r.source_url,
    ingredientNames: (r.ingredients ?? []).map((i) => i.name),
  }));
  return findPossibleDuplicates(
    { title: String(draft.title).slice(0, 200), source_url: draft.source_url ?? null, ingredientNames: (draft.ingredients ?? []).map((i) => String(i.name ?? '')).slice(0, 200) },
    existing,
    excludeId,
  );
}
