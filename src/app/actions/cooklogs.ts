'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_PROCESSED_BYTES, MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/images/limits';
import { ImageValidationError, processRecipeImage } from '@/lib/images/process';
import { userOverImageQuota } from '@/lib/images/quota';
import { enforceRateLimit } from '@/lib/rate-limit';
import { cookPhotoPath, parseCookLogInput } from '@/lib/cooking/cook-log';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();
const BUCKET = 'recipe-images';

/**
 * Records "I cooked this". The recipe must be readable by the user (RLS checks it again on insert).
 * The optional photo goes through the same pipeline as recipe images (type/size checks, sharp
 * re-encode, EXIF stripped) and is written with the service role under <user>/cook/.
 */
export async function createCookLog(formData: FormData): Promise<ActionResult<{ id: string }>> {
  let uploaded: string | null = null;
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const input = parseCookLogInput({ recipeId: formData.get('recipeId'), note: formData.get('note'), date: formData.get('date'), visibility: formData.get('visibility') });
    if (!input) return fail('invalid_input');
    const file = formData.get('file');
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile) {
      if (file.size > MAX_UPLOAD_BYTES) return fail('image_too_large');
      if (!isAllowedUploadType(file.type)) return fail('invalid_input');
    }

    const supabase = await createClient();
    const { data: recipe } = await supabase.from('recipes').select('id').eq('id', input.recipeId).maybeSingle();
    if (!recipe) return fail('not_found');

    let photoPath: string | null = null;
    if (hasFile) {
      await enforceRateLimit('upload_image', user.id);
      await enforceRateLimit('upload_image_day', user.id);
      if (await userOverImageQuota(supabase, user.id)) return fail('storage_quota_exceeded');
      const processed = await processRecipeImage(Buffer.from(await file.arrayBuffer()));
      if (processed.full.length > MAX_PROCESSED_BYTES) return fail('image_too_large');
      photoPath = cookPhotoPath(user.id, randomUUID());
      const up = await createAdminClient().storage.from(BUCKET).upload(photoPath, processed.full, { contentType: 'image/webp', upsert: false });
      if (up.error) return fail('generic');
      uploaded = photoPath;
    }

    const { data, error } = await supabase
      .from('cook_logs')
      .insert({ recipe_id: input.recipeId, user_id: user.id, cooked_at: input.cookedAt, note: input.note, visibility: input.visibility, photo_path: photoPath })
      .select('id')
      .single();
    if (error) {
      if (uploaded) await createAdminClient().storage.from(BUCKET).remove([uploaded]);
      return dbFailure(error, 'createCookLog');
    }
    revalidatePath(`/recipes/${input.recipeId}`);
    revalidatePath('/recipes/cooked');
    return ok({ id: data.id as string });
  } catch (e) {
    if (uploaded) await createAdminClient().storage.from(BUCKET).remove([uploaded]).catch(() => {});
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'createCookLog');
  }
}

/** The author, or the owner of the recipe, can delete a log (RLS decides); the photo goes with it. */
export async function deleteCookLog(logId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(logId).success) return fail('forbidden');
  const supabase = await createClient();
  const { data: row } = await supabase.from('cook_logs').select('recipe_id, photo_path').eq('id', logId).maybeSingle();
  if (!row) return fail('not_found');
  const { data: deleted, error } = await supabase.from('cook_logs').delete().eq('id', logId).select('id');
  if (error) return dbFailure(error, 'deleteCookLog');
  if (!deleted?.length) return fail('forbidden');
  if (row.photo_path) await createAdminClient().storage.from(BUCKET).remove([row.photo_path as string]);
  revalidatePath(`/recipes/${row.recipe_id}`);
  revalidatePath('/recipes/cooked');
  return ok();
}

/** Switches a log between private and "same as recipe" (author only, enforced by RLS). */
export async function setCookLogVisibility(logId: string, visibility: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(logId).success || (visibility !== 'private' && visibility !== 'recipe')) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('cook_logs').update({ visibility }).eq('id', logId).eq('user_id', user.id).select('recipe_id');
  if (error) return dbFailure(error, 'setCookLogVisibility');
  if (!data?.length) return fail('not_found');
  revalidatePath(`/recipes/${data[0].recipe_id}`);
  revalidatePath('/recipes/cooked');
  return ok();
}
