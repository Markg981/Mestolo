'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { RateLimitedError, clientIpHash, enforceRateLimit, hashKey, type LimitName } from '@/lib/rate-limit';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';
import { fail, type ErrorCode } from './_utils';

export type AuthState = { error?: ErrorCode; sent?: boolean; email?: string } | undefined;

/**
 * For auth we only surface our own limit; if the limiter is unavailable we rely
 * on Supabase Auth's built-in rate limits instead of locking everybody out.
 */
async function authRateLimit(limit: LimitName, subject: string) {
  try {
    await enforceRateLimit(limit, subject);
  } catch (e) {
    if (e instanceof RateLimitedError) throw e;
  }
}

const credentials = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(200),
});

function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

async function setLocaleCookie(locale: string | undefined) {
  if (isLocale(locale)) {
    (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { error: 'auth_invalid', email: String(formData.get('email') ?? '') };
  try {
    await authRateLimit('login_ip', await clientIpHash());
    await authRateLimit('login_email', hashKey(parsed.data.email.toLowerCase()));
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
  redirect(safeNext(formData.get('next')));
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
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env().siteUrl}/auth/callback?next=/`,
      data: { username: parsed.data.username, locale: isLocale(parsed.data.locale) ? parsed.data.locale : 'it' },
    },
  });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { error: 'auth_email_taken', email: parsed.data.email };
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
  const pw = z.string().min(8).max(200).safeParse(formData.get('password'));
  if (!pw.success) return { error: 'auth_weak_password' };
  if (formData.get('password') !== formData.get('confirm')) return { error: 'invalid_input' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: 'generic' };
  redirect('/?password=updated');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/welcome');
}
