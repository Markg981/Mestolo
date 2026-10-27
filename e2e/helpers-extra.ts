import type { Page } from '@playwright/test';

/**
 * Il service worker si registra solo in produzione (`next build` + `next start`, o E2E_BASE_URL
 * verso un ambiente deployato): con `next dev` `navigator.serviceWorker.ready` non si risolve mai.
 * Restituisce true se entro `timeoutMs` c'e' un service worker attivo.
 */
export async function serviceWorkerReady(page: Page, timeoutMs = 10_000): Promise<boolean> {
  return page.evaluate(async (ms) => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
    return Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  }, timeoutMs);
}

/** Nomi delle cache private dell'utente (`mestolo-user-<hash>`) presenti nel browser. */
export async function userCacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).filter((n) => n === 'mestolo-user' || n.startsWith('mestolo-user-')));
}

/** Chiavi delle bozze locali (`mestolo:draft:*`) presenti in localStorage. */
export async function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mestolo:draft:')));
}
