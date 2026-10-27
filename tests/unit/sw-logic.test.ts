import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../public/sw-logic.js');
const L = (globalThis as unknown as { MestoloSw: unknown }).MestoloSw as {
  userCacheName: (h: string) => string;
  cachesToDelete: (names: string[], keep: string | null) => string[];
  isSessionLost: (status: number, redirected: boolean, url: string) => boolean;
  canUseUserCache: (h: unknown) => boolean;
  shouldEvictImage: (s: number) => boolean;
  isFresh: (c: unknown, now: number, ttl?: number) => boolean;
  PRIVATE_TTL_MS: number;
  parsePushPayload: (t: string) => { title: string; body: string; tag: string; url: string };
};

describe('service worker: payload push', () => {
  it('legge titolo, testo e url dal JSON', () => {
    expect(L.parsePushPayload('{"title":"Mestolo","body":"Stasera: Risotto","url":"/plan","tag":"meal-1"}')).toEqual({ title: 'Mestolo', body: 'Stasera: Risotto', tag: 'meal-1', url: '/plan' });
  });
  it('usa valori sicuri con payload vuoto o non valido', () => {
    expect(L.parsePushPayload('')).toMatchObject({ title: 'Mestolo', body: '', url: '/plan' });
    expect(L.parsePushPayload('not json')).toMatchObject({ title: 'Mestolo', url: '/plan' });
  });
  it('rifiuta url verso altri origin', () => {
    expect(L.parsePushPayload('{"url":"https://evil.example/x"}').url).toBe('/plan');
    expect(L.parsePushPayload('{"url":"//evil.example"}').url).toBe('/plan');
    expect(L.parsePushPayload('{"url":"/recipes"}').url).toBe('/recipes');
  });
});

describe('service worker: cache per utente', () => {
  it('il nome della cache dipende dall hash utente', () => {
    expect(L.userCacheName('abc')).toBe('mestolo-user-abc');
    expect(L.userCacheName('abc')).not.toBe(L.userCacheName('abd'));
  });

  it('cancella le cache private degli altri utenti e quella legacy, non le statiche', () => {
    const names = ['mestolo-static-v2', 'mestolo-meta', 'mestolo-user', 'mestolo-user-a', 'mestolo-user-b'];
    expect(L.cachesToDelete(names, 'a')).toEqual(['mestolo-user', 'mestolo-user-b']);
    expect(L.cachesToDelete(names, null)).toEqual(['mestolo-user', 'mestolo-user-a', 'mestolo-user-b']);
  });

  it('riconosce la sessione persa da 401 o redirect al login', () => {
    expect(L.isSessionLost(401, false, 'https://x.it/recipes')).toBe(true);
    expect(L.isSessionLost(200, true, 'https://x.it/login?next=/')).toBe(true);
    expect(L.isSessionLost(200, true, 'https://x.it/auth/callback')).toBe(true);
    expect(L.isSessionLost(200, true, 'https://x.it/recipes/')).toBe(false);
    expect(L.isSessionLost(200, false, 'https://x.it/login')).toBe(false);
    expect(L.isSessionLost(500, false, 'https://x.it/')).toBe(false);
  });

  it('senza utente noto non usa la cache privata', () => {
    expect(L.canUseUserCache(null)).toBe(false);
    expect(L.canUseUserCache('')).toBe(false);
    expect(L.canUseUserCache('abc')).toBe(true);
  });

  it('toglie le immagini non piu accessibili', () => {
    for (const s of [401, 403, 404, 410]) expect(L.shouldEvictImage(s)).toBe(true);
    for (const s of [200, 304, 500]) expect(L.shouldEvictImage(s)).toBe(false);
  });
});

describe('service worker: TTL cache privata', () => {
  const now = 1_000_000_000_000;
  it('accetta una copia recente', () => {
    expect(L.isFresh(String(now - 1000), now)).toBe(true);
  });
  it('scarta una copia oltre il TTL', () => {
    expect(L.isFresh(String(now - L.PRIVATE_TTL_MS - 1), now)).toBe(false);
  });
  it('scarta timestamp assente, non valido o nel futuro', () => {
    expect(L.isFresh(null, now)).toBe(false);
    expect(L.isFresh('abc', now)).toBe(false);
    expect(L.isFresh(String(now + 5000), now)).toBe(false);
  });
});
