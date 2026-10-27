'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const uuid = z.uuid();
const name = z.string().trim().min(1).max(80);

export async function createCollection(rawName: string, description = ''): Promise<ActionResult<{ id: string }>> {
  const user = await getUser();
  const n = name.safeParse(rawName);
  if (!user || !n.success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('collections')
    .insert({ owner_id: user.id, name: n.data, description: description.slice(0, 500) })
    .select('id')
    .single();
  if (error) return dbFailure(error, 'createCollection');
  revalidatePath('/collections');
  return ok({ id: data.id as string });
}

export async function renameCollection(id: string, rawName: string, description: string): Promise<ActionResult> {
  const user = await getUser();
  const n = name.safeParse(rawName);
  if (!user || !n.success || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('collections').update({ name: n.data, description: description.slice(0, 500) }).eq('id', id).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'renameCollection');
  revalidatePath(`/collections/${id}`);
  revalidatePath('/collections');
  return ok();
}

export async function deleteCollection(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('collections').delete().eq('id', id).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'deleteCollection');
  revalidatePath('/collections');
  return ok();
}

export async function setRecipeInCollection(collectionId: string, recipeId: string, member: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(collectionId).success || !uuid.safeParse(recipeId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = member
    ? await supabase.from('collection_recipes').upsert({ collection_id: collectionId, recipe_id: recipeId }, { onConflict: 'collection_id,recipe_id', ignoreDuplicates: true })
    : await supabase.from('collection_recipes').delete().eq('collection_id', collectionId).eq('recipe_id', recipeId);
  if (error) return dbFailure(error, 'setRecipeInCollection');
  await supabase.from('collections').update({ updated_at: new Date().toISOString() }).eq('id', collectionId);
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath(`/recipes/${recipeId}`);
  return ok();
}

const visibilitySchema = z.enum(['private', 'friends', 'public']);
const roleSchema = z.enum(['viewer', 'editor']);

export async function setCollectionVisibility(id: string, visibility: string): Promise<ActionResult> {
  const user = await getUser();
  const v = visibilitySchema.safeParse(visibility);
  if (!user || !v.success || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('collections').update({ visibility: v.data }).eq('id', id).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'setCollectionVisibility');
  revalidatePath(`/collections/${id}`);
  revalidatePath('/collections');
  return ok();
}

export async function addCollectionMember(collectionId: string, userId: string, role: string): Promise<ActionResult> {
  const user = await getUser();
  const r = roleSchema.safeParse(role);
  if (!user || !r.success || !uuid.safeParse(collectionId).success || !uuid.safeParse(userId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase
    .from('collection_members')
    .upsert({ collection_id: collectionId, user_id: userId, role: r.data, invited_by: user.id });
  if (error) return dbFailure(error, 'addCollectionMember');
  revalidatePath(`/collections/${collectionId}`);
  return ok();
}

export async function removeCollectionMember(collectionId: string, userId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(collectionId).success || !uuid.safeParse(userId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('collection_members').delete().eq('collection_id', collectionId).eq('user_id', userId).select('user_id');
  if (error) return dbFailure(error, 'removeCollectionMember');
  if (!data?.length) return fail('not_found');
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/collections');
  return ok();
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'cat'
  );
}

export async function createCategory(rawName: string): Promise<ActionResult<{ id: string }>> {
  const user = await getUser();
  const n = z.string().trim().min(1).max(40).safeParse(rawName);
  if (!user || !n.success) return fail('invalid_input');
  const supabase = await createClient();
  const slug = `${slugify(n.data)}-${Math.random().toString(36).slice(2, 5)}`;
  const { data, error } = await supabase.from('categories').insert({ owner_id: user.id, slug, name: n.data, sort_order: 500 }).select('id').single();
  if (error) return dbFailure(error, 'createCategory');
  revalidatePath('/recipes');
  revalidatePath('/settings');
  return ok({ id: data.id as string });
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('categories').delete().eq('id', id).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'deleteCategory');
  revalidatePath('/settings');
  return ok();
}
