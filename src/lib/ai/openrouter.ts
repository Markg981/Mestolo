import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * «Collega il tuo account AI» via OpenRouter OAuth PKCE (https://openrouter.ai/docs/use-cases/oauth-pkce):
 * the user signs in on OpenRouter, authorizes Mestolo and comes back with a one-time code
 * that the server exchanges for a user-controlled API key.
 */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_CALLBACK_PATH = '/api/ai/openrouter/callback';
/** httpOnly cookie holding verifier/state between the redirect and the callback (codes expire after 10 minutes). */
export const OPENROUTER_PKCE_COOKIE = 'mestolo_openrouter_pkce';
export const OPENROUTER_PKCE_MAX_AGE = 600;

export class OpenRouterExchangeError extends Error {
  constructor(public readonly status: number) {
    super(`openrouter key exchange failed (${status})`);
  }
}

const base64url = (b: Buffer) => b.toString('base64url');

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()), state: base64url(randomBytes(16)) };
}

export function authorizeUrl(siteUrl: string, challenge: string, state: string): string {
  const u = new URL('https://openrouter.ai/auth');
  u.searchParams.set('callback_url', `${siteUrl}${OPENROUTER_CALLBACK_PATH}`);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('key_label', 'Mestolo');
  return u.toString();
}

export const pkceCookieSchema = z.object({ v: z.string().min(43).max(128), s: z.string().min(16).max(64), u: z.string().uuid() });
export type PkceCookie = z.infer<typeof pkceCookieSchema>;

export function readPkceCookie(raw: string | undefined): PkceCookie | null {
  if (!raw) return null;
  try {
    const p = pkceCookieSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const exchangeSchema = z.object({ key: z.string().trim().min(20).max(400).regex(/^[\x21-\x7e]+$/) });

/** Exchanges the single-use authorization code for the user's OpenRouter key. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${OPENROUTER_BASE_URL}/auth/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new OpenRouterExchangeError(res.status);
  const p = exchangeSchema.safeParse(await res.json().catch(() => null));
  if (!p.success) throw new OpenRouterExchangeError(502);
  return p.data.key;
}
