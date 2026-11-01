import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { getUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptSecret, keyAad, keyHint, loadEncryptionKey } from '@/lib/crypto/secrets';
import { exchangeCode, OPENROUTER_CALLBACK_PATH, OPENROUTER_PKCE_COOKIE, readPkceCookie } from '@/lib/ai/openrouter';
import { enforceRateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';

type Outcome = 'connected' | 'cancelled' | 'error';

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** OpenRouter sends the user back here with ?code&state after the authorization (OAuth PKCE). */
export async function GET(req: NextRequest) {
  const done = (outcome: Outcome) => {
    const res = NextResponse.redirect(new URL(`/settings/ai?openrouter=${outcome}`, env().siteUrl));
    // single use: verifier/state never survive the callback, whatever the outcome
    res.cookies.set(OPENROUTER_PKCE_COOKIE, '', { path: OPENROUTER_CALLBACK_PATH, maxAge: 0 });
    return res;
  };
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const pkce = readPkceCookie(req.cookies.get(OPENROUTER_PKCE_COOKIE)?.value);
  if (!code) return done(pkce ? 'cancelled' : 'error');
  const user = await getUser();
  // stato legato al cookie e all'utente che ha avviato il collegamento (CSRF / sessione cambiata nel frattempo)
  if (!user || !pkce || pkce.u !== user.id || !sameString(pkce.s, state) || code.length > 512) return done('error');
  try {
    await enforceRateLimit('api_key_change', user.id);
    const apiKey = await exchangeCode(code, pkce.v);
    const enc = encryptSecret(apiKey, loadEncryptionKey(env().encryptionKey), keyAad(user.id, 'openrouter'));
    const { error } = await createAdminClient()
      .from('user_api_keys')
      .upsert(
        { user_id: user.id, provider: 'openrouter', ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag, key_hint: keyHint(apiKey), updated_at: new Date().toISOString() },
        { onConflict: 'user_id,provider' },
      );
    if (error) throw error;
  } catch (e) {
    console.error('[ai] openrouter connect failed', e instanceof Error ? e.message : e);
    return done('error');
  }
  revalidatePath('/settings/ai');
  return done('connected');
}
