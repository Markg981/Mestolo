import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const KEY = randomBytes(32).toString('base64');
const USER = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rows: [] as unknown[],
  upserts: [] as { row: Record<string, unknown>; opts: unknown }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => state.user,
  createClient: async () => ({ rpc: async () => ({ data: true, error: null }) }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: state.rows, error: null }) }),
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        state.upserts.push({ row, opts });
        return { error: null };
      },
    }),
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => undefined }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/env', () => ({
  ConfigError: class ConfigError extends Error {},
  env: () => ({
    siteUrl: 'https://mestolo.test',
    encryptionKey: KEY,
    encryptionKeyPrevious: undefined,
    ai: {
      appProvider: '',
      appApiKey: '',
      limits: { text: 5, vision: 5, image: 5, translate: 5 },
      userAnthropicModel: 'm',
      userOpenaiTextModel: 'm',
      userOpenaiImageModel: 'm',
      userOpenrouterModel: 'openai/gpt-5-mini',
      transcribeModel: 'm',
    },
  }),
}));

import { authorizeUrl, createPkce, exchangeCode, OpenRouterExchangeError, OPENROUTER_PKCE_COOKIE, readPkceCookie } from '@/lib/ai/openrouter';
import { capabilityStatus, resolveProvider } from '@/lib/ai/service';
import { decryptSecret, encryptSecret, keyAad } from '@/lib/crypto/secrets';
import { GET } from '@/app/api/ai/openrouter/callback/route';

const OR_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('PKCE OpenRouter', () => {
  it('challenge = base64url(sha256(verifier)) e URL di autorizzazione completa', () => {
    const p = createPkce();
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(authorizeUrl('https://mestolo.test', p.challenge, p.state));
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(u.searchParams.get('callback_url')).toBe('https://mestolo.test/api/ai/openrouter/callback');
    expect(u.searchParams.get('code_challenge')).toBe(p.challenge);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(p.state);
  });

  it('cookie PKCE: valido solo se ben formato', () => {
    const p = createPkce();
    expect(readPkceCookie(JSON.stringify({ v: p.verifier, s: p.state, u: USER }))).toEqual({ v: p.verifier, s: p.state, u: USER });
    expect(readPkceCookie(undefined)).toBeNull();
    expect(readPkceCookie('{nope')).toBeNull();
    expect(readPkceCookie(JSON.stringify({ v: 'corto', s: p.state, u: USER }))).toBeNull();
  });

  it('scambio del codice: invia code, verifier e metodo, restituisce la chiave', async () => {
    const f = vi.fn(async () => jsonResponse({ key: OR_KEY, user_id: 'x' }));
    expect(await exchangeCode('code-1', 'v'.repeat(43), f as unknown as typeof fetch)).toBe(OR_KEY);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'code-1', code_verifier: 'v'.repeat(43), code_challenge_method: 'S256' });
  });

  it('scambio fallito o risposta senza chiave: errore esplicito', async () => {
    await expect(exchangeCode('c', 'v', (async () => jsonResponse({ error: 'expired' }, 403)) as unknown as typeof fetch)).rejects.toBeInstanceOf(OpenRouterExchangeError);
    await expect(exchangeCode('c', 'v', (async () => jsonResponse({ nokey: true })) as unknown as typeof fetch)).rejects.toBeInstanceOf(OpenRouterExchangeError);
  });
});

describe('callback /api/ai/openrouter/callback', () => {
  const pkce = createPkce();
  const cookie = JSON.stringify({ v: pkce.verifier, s: pkce.state, u: USER });
  const req = (query: string, withCookie = true) =>
    new NextRequest(`https://mestolo.test/api/ai/openrouter/callback?${query}`, { headers: withCookie ? { cookie: `${OPENROUTER_PKCE_COOKIE}=${encodeURIComponent(cookie)}` } : {} });

  beforeEach(() => {
    state.user = { id: USER };
    state.upserts = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('collega: scambia il codice, salva la chiave cifrata come provider openrouter e cancella il cookie', async () => {
    const f = vi.fn(async () => jsonResponse({ key: OR_KEY }));
    vi.stubGlobal('fetch', f);
    const res = await GET(req(`code=abc&state=${pkce.state}`));
    expect(res.headers.get('location')).toBe('https://mestolo.test/settings/ai?openrouter=connected');
    expect(res.headers.get('set-cookie')).toContain(`${OPENROUTER_PKCE_COOKIE}=;`);
    expect(state.upserts).toHaveLength(1);
    const { row } = state.upserts[0];
    expect(row).toMatchObject({ user_id: USER, provider: 'openrouter', key_hint: expect.any(String) });
    expect(JSON.stringify(row)).not.toContain(OR_KEY);
    const plain = decryptSecret({ ciphertext: row.ciphertext as string, iv: row.iv as string, authTag: row.auth_tag as string }, Buffer.from(KEY, 'base64'), keyAad(USER, 'openrouter'));
    expect(plain).toBe(OR_KEY);
  });

  it('state diverso, cookie mancante o altro utente: nessuno scambio', async () => {
    const f = vi.fn(async () => jsonResponse({ key: OR_KEY }));
    vi.stubGlobal('fetch', f);
    expect((await GET(req('code=abc&state=altro-state-xxxxxx'))).headers.get('location')).toContain('openrouter=error');
    expect((await GET(req(`code=abc&state=${pkce.state}`, false))).headers.get('location')).toContain('openrouter=error');
    state.user = { id: '22222222-2222-4222-8222-222222222222' };
    expect((await GET(req(`code=abc&state=${pkce.state}`))).headers.get('location')).toContain('openrouter=error');
    state.user = null;
    expect((await GET(req(`code=abc&state=${pkce.state}`))).headers.get('location')).toContain('openrouter=error');
    expect(f).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(0);
  });

  it('utente che annulla su OpenRouter (nessun codice): annullato, niente salvato', async () => {
    const res = await GET(req(`state=${pkce.state}`));
    expect(res.headers.get('location')).toBe('https://mestolo.test/settings/ai?openrouter=cancelled');
    expect(state.upserts).toHaveLength(0);
  });

  it('codice scaduto (403 da OpenRouter): errore, niente salvato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'expired' }, 403)));
    const res = await GET(req(`code=abc&state=${pkce.state}`));
    expect(res.headers.get('location')).toContain('openrouter=error');
    expect(state.upserts).toHaveLength(0);
  });
});

describe('servizio AI con account OpenRouter', () => {
  beforeEach(() => {
    const e = encryptSecret(OR_KEY, Buffer.from(KEY, 'base64'), keyAad(USER, 'openrouter'));
    state.rows = [{ provider: 'openrouter', ciphertext: e.ciphertext, iv: e.iv, auth_tag: e.authTag }];
  });

  it('testo e foto passano dal tuo account OpenRouter', async () => {
    expect(await capabilityStatus(USER, 'text', 'text')).toMatchObject({ available: true, keySource: 'user', providerName: 'OpenRouter' });
    const r = await resolveProvider(USER, 'vision', 'vision', 'test');
    expect(r).toMatchObject({ keySource: 'user', providerName: 'OpenRouter' });
    expect(r.provider.id).toBe('openrouter');
  });

  it('le immagini non passano da OpenRouter (senza servizio base: non disponibili)', async () => {
    expect(await capabilityStatus(USER, 'image', 'image')).toMatchObject({ available: false, keySource: null });
    await expect(resolveProvider(USER, 'image', 'image', 'test')).rejects.toThrow();
  });

  it('le chiamate vanno a openrouter.ai con il modello configurato', async () => {
    const f = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', f);
    const r = await resolveProvider(USER, 'text', 'text', 'test');
    await r.provider.completeJson({ system: 's', user: 'u' }).catch(() => undefined);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization ?? (init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OR_KEY}`);
    expect(JSON.parse(init.body as string).model).toBe('openai/gpt-5-mini');
    vi.unstubAllGlobals();
  });
});
