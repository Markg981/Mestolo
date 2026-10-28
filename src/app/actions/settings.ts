'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { invalidateAllPublicPages } from '@/lib/data/public-invalidation';
import { z } from 'zod';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient, getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptSecret, keyAad, keyHint, loadEncryptionKey } from '@/lib/crypto/secrets';
import { deleteAccountData, type DeletionAdmin } from '@/lib/account-deletion';
import { env } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';
import { richProfileSchema } from '@/lib/profile/validation';
import { DIETS } from '@/lib/recipes/diets';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const profileSchema = richProfileSchema.extend({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  display_name: z.string().trim().max(60),
  discoverable: z.boolean(),
  dietary_preferences: z.array(z.enum(DIETS)).max(DIETS.length),
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
export async function deleteAccount(confirmUsername: string, password: string): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    await enforceRateLimit('account_delete', user.id);
    // Nuova autenticazione: una sessione rubata non basta. Client separato, senza persistenza,
    // cosi' la sessione corrente non viene toccata.
    const { supabaseUrl, supabaseAnonKey } = env();
    if (!user.email || typeof password !== 'string' || !password || password.length > 256) return fail('auth_invalid');
    const verifier = createSupabaseClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: verified, error: authError } = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (authError || verified.user?.id !== user.id) return fail('auth_invalid');
    const supabase = await createClient();
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    if (!profile || profile.username !== String(confirmUsername ?? '').trim().toLowerCase()) return fail('invalid_input');
    // Avatar file: a failure aborts before the account is touched, so the face photo is never left behind
    // (a retry of the deletion repeats it, removing a missing file is a no-op)
    const { data: mine } = await supabase.rpc('my_profile').maybeSingle();
    const avatar = (mine as { avatar_path?: string | null } | null)?.avatar_path;
    if (avatar) {
      const { error: avatarError } = await createAdminClient().storage.from('avatars').remove([avatar]);
      if (avatarError) throw new Error(`avatar remove failed: ${avatarError.message}`);
    }
    // Slug pubblici letti prima: dopo l'eliminazione le righe non esistono piu' e le pagine in cache resterebbero online
    const { data: pubs } = await supabase.from('recipes').select('public_slug').eq('owner_id', user.id).not('public_slug', 'is', null);
    await deleteAccountData(createAdminClient() as unknown as DeletionAdmin, user.id);
    invalidateAllPublicPages(((pubs as { public_slug: string | null }[] | null) ?? []).map((p) => p.public_slug));
    await supabase.auth.signOut();
  } catch (e) {
    return toFailure(e, 'deleteAccount');
  }
  // Niente redirect lato server: il client deve prima svuotare cache del service worker e bozze locali
  return ok();
}
