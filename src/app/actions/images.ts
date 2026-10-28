'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { invalidatePublicPageForRecipe } from '@/lib/data/public-invalidation';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_IMAGES_PER_USER, MAX_PROCESSED_BYTES, MAX_STORAGE_BYTES_PER_USER, MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/images/limits';
import { ImageValidationError, processRecipeImage } from '@/lib/images/process';
import { userOverImageQuota } from '@/lib/images/quota';
import { enforceRateLimit } from '@/lib/rate-limit';
import { safeFetch } from '@/lib/import/safe-fetch';
import { resolveProvider, recordUsage } from '@/lib/ai/service';
import { withRefund } from '@/lib/ai/refund';
import { imagePrompt } from '@/lib/ai/prompts';
import { AiError } from '@/lib/ai/providers';
import type { Ingredient } from '@/lib/recipes/types';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const attributionSchema = z
  .string()
  .transform((v) => v.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(300))
  .nullable();

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/** Dominio "registrabile" approssimato (euristica senza public suffix list). */
function baseDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const keep = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** True se l'immagine sta sullo stesso sito (o un suo sottodominio/CDN fratello) della source_url della ricetta. */
function isImageFromRecipeSource(sourceUrl: string | null | undefined, imageUrl: string): boolean {
  if (!sourceUrl) return false;
  try {
    const s = new URL(sourceUrl);
    const i = new URL(imageUrl);
    if (!/^https?:$/.test(s.protocol) || !/^https?:$/.test(i.protocol)) return false;
    if (s.hostname.toLowerCase() === i.hostname.toLowerCase()) return true;
    if (!s.hostname.includes('.') || !i.hostname.includes('.')) return false;
    return baseDomain(s.hostname) === baseDomain(i.hostname);
  } catch {
    return false;
  }
}

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
  if (await userOverImageQuota(supabase, opts.userId)) return fail('storage_quota_exceeded');

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
  // Posizione e quota calcolate nel DB sotto lock: due upload simultanei non si sovrappongono.
  const { data: newId, error } = await supabase.rpc('insert_recipe_image', {
    p_recipe_id: opts.recipeId,
    p_storage_path: path,
    p_thumb_path: thumbPath,
    p_kind: opts.kind,
    p_source_url: opts.sourceUrl ?? null,
    p_attribution: opts.attribution ?? null,
    p_alt: opts.alt.slice(0, 300),
    p_width: processed.width,
    p_height: processed.height,
    p_max_images: MAX_IMAGES_PER_USER,
    // byte reali dei buffer elaborati dal server (file + miniatura), non valori dichiarati dal client
    p_size_bytes: processed.full.length + processed.thumb.length,
    p_max_bytes: MAX_STORAGE_BYTES_PER_USER,
  });
  if (error) {
    await bucket.remove([path, thumbPath]);
    return dbFailure(error, 'storeImage');
  }
  if (!newId) {
    await bucket.remove([path, thumbPath]);
    return fail('storage_quota_exceeded');
  }
  revalidatePath(`/recipes/${opts.recipeId}`);
  await invalidatePublicPageForRecipe(supabase, opts.recipeId);
  return ok({ id: newId as string });
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
    const attr = attributionSchema.safeParse(attribution ?? null);
    if (!attr.success) return fail('invalid_input');
    const cleanAttribution = attr.data ? attr.data : null;
    // Ownership check BEFORE any outbound fetch (no SSRF/bandwidth for non-owners).
    const supabase = await createClient();
    const { data: owned } = await supabase.from('recipes').select('id, source_url').eq('id', recipeId).eq('owner_id', user.id).maybeSingle();
    if (!owned) return fail('not_found');
    // Solo immagini provenienti dalla pagina importata (stesso sito della source_url), non URL arbitrari.
    if (!isImageFromRecipeSource((owned as { source_url?: string | null }).source_url, imageUrl)) return fail('invalid_input');
    await enforceRateLimit('upload_image', user.id);
    await enforceRateLimit('upload_image_day', user.id);
    const res = await safeFetch(imageUrl, { maxBytes: MAX_UPLOAD_BYTES, accept: 'image/*', allowedContentTypes: /^image\/(jpeg|png|webp|avif|gif)/i });
    if (res.truncated) return fail('image_too_large');
    return await storeImage({ userId: user.id, recipeId, buffer: res.body, kind: 'imported', alt: '', sourceUrl: res.finalUrl, attribution: cleanAttribution });
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
  const { data: deleted, error } = await supabase.from('recipe_images').delete().eq('id', imageId).eq('owner_id', user.id).select('id');
  if (error) return dbFailure(error, 'deleteRecipeImage');
  if (!deleted || deleted.length === 0) return fail('not_found');
  // Solo dopo l'esito positivo sul DB: un errore dello storage è solo loggato (file orfano, non riga orfana).
  const { error: storageError } = await supabase.storage.from('recipe-images').remove([img.storage_path, img.thumb_path].filter(Boolean) as string[]);
  if (storageError) console.error(`[mestolo] deleteRecipeImage: storage remove failed: ${storageError.message}`);
  revalidatePath(`/recipes/${img.recipe_id}`);
  await invalidatePublicPageForRecipe(supabase, img.recipe_id as string);
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
    // Storage pieno: blocca PRIMA di consumare quota AI e di chiamare il provider (a pagamento).
    if (await userOverImageQuota(supabase, user.id)) return fail('storage_quota_exceeded');
    const resolved = await resolveProvider(user.id, 'image', 'image', 'generate');
    return await withRefund(user.id, resolved, 'image', 'generate', async (paid) => {
      if (!resolved.provider.generateImage) throw new AiError('unsupported');
      const img = await resolved.provider.generateImage(imagePrompt(r.title, r.description, ((r.ingredients as Ingredient[]) ?? []).map((i) => i.name)));
      paid();
      await recordUsage(user.id, 'image', 'generate', resolved);
      return await storeImage({
        userId: user.id,
        recipeId,
        buffer: Buffer.from(img.base64, 'base64'),
        kind: 'ai_generated',
        alt: r.title,
        attribution: resolved.providerName,
      });
    });
  } catch (e) {
    if (e instanceof ImageValidationError) return fail('ai_bad_output');
    return toFailure(e, 'generateRecipeImage');
  }
}
