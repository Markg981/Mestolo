'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/images/limits';
import { ImageValidationError, processAvatar } from '@/lib/images/process';
import { enforceRateLimit } from '@/lib/rate-limit';
import { fail, ok, toFailure, type ActionResult } from './_utils';

async function currentAvatarPath(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_profile').maybeSingle();
  return ((data as { avatar_path?: string | null } | null)?.avatar_path as string | null | undefined) ?? null;
}

/** Replaces the avatar: validated, squared and re-encoded on the server, written with the service role only. */
export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const file = formData.get('file');
    if (!(file instanceof File)) return fail('invalid_input');
    if (file.size > MAX_UPLOAD_BYTES) return fail('image_too_large');
    if (!isAllowedUploadType(file.type)) return fail('invalid_input');
    await enforceRateLimit('upload_image', user.id);
    const image = await processAvatar(Buffer.from(await file.arrayBuffer()));
    const path = `${user.id}/${randomUUID()}.webp`;
    const admin = createAdminClient();
    const up = await admin.storage.from('avatars').upload(path, image, { contentType: 'image/webp', upsert: false });
    if (up.error) return fail('generic');
    const old = await currentAvatarPath();
    const { error } = await admin.from('profiles').update({ avatar_path: path }).eq('id', user.id);
    if (error) {
      await admin.storage.from('avatars').remove([path]);
      return fail('generic');
    }
    if (old) await admin.storage.from('avatars').remove([old]);
    revalidatePath('/', 'layout');
    return ok();
  } catch (e) {
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'uploadAvatar');
  }
}

export async function removeAvatar(): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const old = await currentAvatarPath();
    const admin = createAdminClient();
    const { error } = await admin.from('profiles').update({ avatar_path: null }).eq('id', user.id);
    if (error) return fail('generic');
    if (old) await admin.storage.from('avatars').remove([old]);
    revalidatePath('/', 'layout');
    return ok();
  } catch (e) {
    return toFailure(e, 'removeAvatar');
  }
}
