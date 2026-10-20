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
};

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
