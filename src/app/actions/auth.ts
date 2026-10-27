'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { safeNextPath } from '@/lib/safe-redirect';
import { clientIpHash, enforceAuthRateLimit, hashKey } from '@/lib/rate-limit';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';
import { passwordSchema } from '@/lib/password';
import { isRecoverySession } from '@/lib/recovery-session';
import { fail, type ErrorCode } from './_utils';

export type AuthState = { error?: ErrorCode; sent?: boolean; email?: string } | undefined;

const authRateLimit = enforceAuthRateLimit;

const credentials = z.object({
  email: z.email().max(320),
  password: passwordSchema,
});

async function setLocaleCookie(locale: string | undefined) {
  if (isLocale(locale)) {
    (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { error: 'auth_invalid', email: String(formData.get('email') ?? '') };
  try {
    const ipHash = await clientIpHash();
    const emailHash = hashKey(parsed.data.email.toLowerCase());
    await authRateLimit('login_ip', ipHash);
    // Tight limit per (email, IP); the email-only ceiling is loose so a third party cannot lock a victim out.
    await authRateLimit('login_email_ip', `${emailHash}:${ipHash}`);
    await authRateLimit('login_email', emailHash);
  } catch {
    return { error: 'rate_limited', email: parsed.data.email };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    const code: ErrorCode = /confirm/i.test(error?.message ?? '') ? 'auth_not_confirmed' : 'auth_invalid';
    return { error: code, email: parsed.data.email };
  }
  const { data: profile } = await supabase.rpc('my_profile').maybeSingle<{ locale: string }>();
  await setLocaleCookie(profile?.locale);
  redirect(safeNextPath(formData.get('next')));
}

const signUpSchema = credentials.extend({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  locale: z.string().optional(),
  terms: z.literal('on'),
});

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    username: formData.get('username'),
    locale: formData.get('locale') ?? undefined,
    terms: formData.get('terms'),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === 'password' ? 'auth_weak_password' : 'invalid_input', email: String(formData.get('email') ?? '') };
  }
  try {
    await authRateLimit('signup_ip', await clientIpHash());
  } catch {
    return fail('rate_limited');
  }
  try {
    const { data: existing } = await createAdminClient().from('profiles').select('id').eq('username', parsed.data.username).maybeSingle();
    if (existing) return { error: 'username_taken', email: parsed.data.email };
  } catch {
    // Without the service role the DB trigger still guarantees uniqueness (it falls back to a generated name).
  }
  // `next` torna dopo la conferma email (es. /invite/<token>): solo percorsi interni
  const next = safeNextPath(formData.get('next'));
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env().siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      data: { username: parsed.data.username, locale: isLocale(parsed.data.locale) ? parsed.data.locale : 'it' },
    },
  });
  if (error) {
    // Limite di invio email di Supabase (429 over_email_send_rate_limit)
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
      return { error: 'rate_limited', email: parsed.data.email };
    }
    // Email già registrata: stessa risposta di una nuova registrazione (nessuna enumerazione degli account).
    // Con la conferma email attiva Supabase non da' errore (utente finto con identities = []).
    if (error.code === 'user_already_exists' || /registered|exists/i.test(error.message)) {
      await setLocaleCookie(parsed.data.locale);
      return { sent: true, email: parsed.data.email };
    }
    if (/password/i.test(error.message)) return { error: 'auth_weak_password', email: parsed.data.email };
    return { error: 'generic', email: parsed.data.email };
  }
  await setLocaleCookie(parsed.data.locale);
  return { sent: true, email: parsed.data.email };
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.email().safeParse(formData.get('email'));
  if (!email.success) return { error: 'invalid_input' };
  try {
    await authRateLimit('reset_ip', await clientIpHash());
  } catch {
    return { error: 'rate_limited' };
  }
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${env().siteUrl}/auth/callback?next=/auth/reset-password`,
  });
  // Same answer whether or not the account exists (no account enumeration)
  return { sent: true, email: email.data };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const pw = passwordSchema.safeParse(formData.get('password'));
  if (!pw.success) return { error: 'auth_weak_password' };
  if (formData.get('password') !== formData.get('confirm')) return { error: 'invalid_input' };
  const supabase = await createClient();
  // Solo da una sessione di recovery appena aperta dal link email: con una sessione normale
  // (dispositivo condiviso, cookie rubato) serve changePassword, che chiede la password attuale.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub || !isRecoverySession(claims)) return { error: 'forbidden' };
  try {
    await authRateLimit('password_update', hashKey(claims.sub));
  } catch {
    return { error: 'rate_limited' };
  }
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: 'generic' };
  redirect('/?password=updated');
}

export async function changePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const current = z.string().min(1).max(200).safeParse(formData.get('current'));
  if (!current.success) return { error: 'invalid_input' };
  const pw = passwordSchema.safeParse(formData.get('password'));
  if (!pw.success) return { error: 'auth_weak_password' };
  if (formData.get('password') !== formData.get('confirm')) return { error: 'invalid_input' };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!userData.user || !email) return { error: 'forbidden' };
  try {
    // Re-verifying the current password is a guessing vector. Own bucket keyed by the authenticated user id
    // (not the email), so it cannot be exhausted from outside nor lock the victim out of signIn.
    // The limiter counts every attempt, not only failures: the cap is therefore tight but per-session-owner.
    await authRateLimit('password_verify', userData.user.id);
  } catch {
    return { error: 'rate_limited' };
  }
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: current.data });
  if (verifyError) return { error: 'auth_wrong_password' };
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: /password/i.test(error.message) ? 'auth_weak_password' : 'generic' };
  return { sent: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/welcome');
}
