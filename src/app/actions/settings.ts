'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptSecret, keyAad, keyHint, loadEncryptionKey } from '@/lib/crypto/secrets';
import { deleteAccountData, type DeletionAdmin } from '@/lib/account-deletion';
import { env } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const profileSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  display_name: z.string().trim().max(60),
  bio: z.string().trim().max(280),
  discoverable: z.boolean(),
  dietary_preferences: z.array(z.enum(['vegetarian', 'vegan', 'pescatarian', 'no_pork', 'no_alcohol'])).max(5),
  avoided_ingredients: z.array(z.string().trim().min(1).max(40)).max(30),
  hidden_categories: z.array(z.string().max(40)).max(20),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = profileSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input', p.success ? undefined : String(p.error.issues[0]?.path[0]));
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(p.data).eq('id', user.id);
  if (error) return error.code === '23505' ? fail('username_taken') : dbFailure(error, 'updateProfile');
  revalidatePath('/', 'layout');
  return ok();
}

export async function setLocale(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail('invalid_input');
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const user = await getUser();
  if (user) {
    const supabase = await createClient();
    await supabase.from('profiles').update({ locale }).eq('id', user.id);
  }
  revalidatePath('/', 'layout');
  return ok();
}

const keySchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  apiKey: z.string().trim().min(20).max(400).regex(/^[\x21-\x7e]+$/),
});

/**
 * Stores a personal API key encrypted (AES-256-GCM) with a key that lives
 * outside the database. The plaintext is never returned, logged or sent to the browser again.
 */
export async function saveApiKey(input: unknown): Promise<ActionResult> {
  try {
    const user = await getUser();
    const p = keySchema.safeParse(input);
    if (!user || !p.success) return fail('invalid_input');
    await enforceRateLimit('api_key_change', user.id);
    const key = loadEncryptionKey(env().encryptionKey);
    const enc = encryptSecret(p.data.apiKey, key, keyAad(user.id, p.data.provider));
    const { error } = await createAdminClient()
      .from('user_api_keys')
      .upsert(
        { user_id: user.id, provider: p.data.provider, ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag, key_hint: keyHint(p.data.apiKey), updated_at: new Date().toISOString() },
        { onConflict: 'user_id,provider' },
      );
    if (error) return dbFailure(error, 'saveApiKey');
    revalidatePath('/settings/ai');
    return ok();
  } catch (e) {
    return toFailure(e, 'saveApiKey');
  }
}

export async function deleteApiKey(provider: string): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user || (provider !== 'anthropic' && provider !== 'openai')) return fail('invalid_input');
    await enforceRateLimit('api_key_change', user.id);
    const { error } = await createAdminClient().from('user_api_keys').delete().eq('user_id', user.id).eq('provider', provider);
    if (error) return dbFailure(error, 'deleteApiKey');
    revalidatePath('/settings/ai');
    return ok();
  } catch (e) {
    return toFailure(e, 'deleteApiKey');
  }
}

/** Permanently deletes the account: storage files first, the auth user last (all rows cascade), then sign out. Safe to retry. */
export async function deleteAccount(confirmUsername: string): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const supabase = await createClient();
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    if (!profile || profile.username !== String(confirmUsername ?? '').trim().toLowerCase()) return fail('invalid_input');
    await deleteAccountData(createAdminClient() as unknown as DeletionAdmin, user.id);
    await supabase.auth.signOut();
  } catch (e) {
    return toFailure(e, 'deleteAccount');
  }
  redirect('/welcome?deleted=1');
}
