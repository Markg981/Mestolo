'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_PROCESSED_BYTES, MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/images/limits';
import { ImageValidationError, processRecipeImage } from '@/lib/images/process';
import { enforceRateLimit } from '@/lib/rate-limit';
import { safeFetch } from '@/lib/import/safe-fetch';
import { resolveProvider, recordUsage } from '@/lib/ai/service';
import { imagePrompt } from '@/lib/ai/prompts';
import { AiError } from '@/lib/ai/providers';
import type { Ingredient } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

async function storeImage(opts: {
  userId: string;
  recipeId: string;
  buffer: Buffer;
  kind: 'upload' | 'imported' | 'ai_generated';
  alt: string;
  sourceUrl?: string | null;
  attribution?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: recipe } = await supabase.from('recipes').select('id').eq('id', opts.recipeId).eq('owner_id', opts.userId).maybeSingle();
  if (!recipe) return fail('not_found');

  const processed = await processRecipeImage(opts.buffer);
  const name = randomUUID();
  const path = `${opts.userId}/${opts.recipeId}/${name}.webp`;
  const thumbPath = `${opts.userId}/${opts.recipeId}/${name}_t.webp`;
  // Writes to the bucket go through the service role only: authenticated users
  // have no INSERT/UPDATE policy on storage.objects (see the migration).
  if (processed.full.length > MAX_PROCESSED_BYTES || processed.thumb.length > MAX_PROCESSED_BYTES) return fail('image_too_large');
  const bucket = createAdminClient().storage.from('recipe-images');
  const up1 = await bucket.upload(path, processed.full, { contentType: 'image/webp', upsert: false });
  if (up1.error) return fail('generic');
  const up2 = await bucket.upload(thumbPath, processed.thumb, { contentType: 'image/webp', upsert: false });
  if (up2.error) {
    await bucket.remove([path]);
    return fail('generic');
  }
  const { count } = await supabase.from('recipe_images').select('id', { count: 'exact', head: true }).eq('recipe_id', opts.recipeId);
  const { data, error } = await supabase
    .from('recipe_images')
    .insert({
      recipe_id: opts.recipeId,
      owner_id: opts.userId,
      storage_path: path,
      thumb_path: thumbPath,
      kind: opts.kind,
      source_url: opts.sourceUrl ?? null,
      attribution: opts.attribution ?? null,
      alt_text: opts.alt.slice(0, 300),
      width: processed.width,
      height: processed.height,
      position: count ?? 0,
    })
    .select('id')
    .single();
  if (error) {
    await bucket.remove([path, thumbPath]);
    return dbFailure(error, 'storeImage');
  }
  revalidatePath(`/recipes/${opts.recipeId}`);
  return ok({ id: data.id as string });
}

export async function uploadRecipeImage(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const recipeId = String(formData.get('recipeId') ?? '');
    const file = formData.get('file');
    if (!uuid.safeParse(recipeId).success || !(file instanceof File)) return fail('invalid_input');
    if (file.size > MAX_UPLOAD_BYTES) return fail('image_too_large');
    if (!isAllowedUploadType(file.type)) return fail('invalid_input');
    await enforceRateLimit('upload_image', user.id);
    await enforceRateLimit('upload_image_day', user.id);
    return await storeImage({
      userId: user.id,
      recipeId,
      buffer: Buffer.from(await file.arrayBuffer()),
      kind: 'upload',
      alt: String(formData.get('alt') ?? '').trim(),
    });
  } catch (e) {
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'uploadRecipeImage');
  }
}

/**
 * Saves a PRIVATE copy of the source page's image, only when the user asked for
 * it explicitly in the review screen. Imported images stay visible only to their
 * owner (enforced by RLS), even if the recipe becomes public.
 */
export async function importSourceImage(recipeId: string, imageUrl: string, attribution: string | null): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    await enforceRateLimit('upload_image', user.id);
    await enforceRateLimit('upload_image_day', user.id);
    const res = await safeFetch(imageUrl, { maxBytes: MAX_UPLOAD_BYTES, accept: 'image/*', allowedContentTypes: /^image\/(jpeg|png|webp|avif|gif)/i });
    if (res.truncated) return fail('image_too_large');
    return await storeImage({ userId: user.id, recipeId, buffer: res.body, kind: 'imported', alt: '', sourceUrl: res.finalUrl, attribution });
  } catch (e) {
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'importSourceImage');
  }
}

export async function deleteRecipeImage(imageId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(imageId).success) return fail('forbidden');
  const supabase = await createClient();
  const { data: img } = await supabase.from('recipe_images').select('recipe_id, storage_path, thumb_path').eq('id', imageId).eq('owner_id', user.id).maybeSingle();
  if (!img) return fail('not_found');
  await supabase.from('recipe_images').delete().eq('id', imageId).eq('owner_id', user.id);
  await supabase.storage.from('recipe-images').remove([img.storage_path, img.thumb_path].filter(Boolean) as string[]);
  revalidatePath(`/recipes/${img.recipe_id}`);
  return ok();
}

/**
 * Generates an image ONLY after explicit confirmation (it may cost money).
 * The result is stored with kind "ai_generated" and always labelled in the UI.
 */
export async function generateRecipeImage(recipeId: string, confirmed: boolean): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(recipeId).success) return fail('forbidden');
    if (confirmed !== true) return fail('invalid_input');
    const supabase = await createClient();
    const { data: r } = await supabase.from('recipes').select('title, description, ingredients').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
    if (!r) return fail('not_found');
    await enforceRateLimit('ai_image', user.id);
    const resolved = await resolveProvider(user.id, 'image', 'image');
    if (!resolved.provider.generateImage) throw new AiError('unsupported');
    const img = await resolved.provider.generateImage(imagePrompt(r.title, r.description, ((r.ingredients as Ingredient[]) ?? []).map((i) => i.name)));
    await recordUsage(user.id, 'image', 'generate', resolved);
    return await storeImage({
      userId: user.id,
      recipeId,
      buffer: Buffer.from(img.base64, 'base64'),
      kind: 'ai_generated',
      alt: r.title,
      attribution: resolved.providerName,
    });
  } catch (e) {
    if (e instanceof ImageValidationError) return fail('ai_bad_output');
    return toFailure(e, 'generateRecipeImage');
  }
}
