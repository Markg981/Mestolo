import { expect, type Page, type Request } from '@playwright/test';

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

/**
 * Naviga e attende che il canale Realtime della pagina sia iscritto ai postgres_changes:
 * una modifica fatta prima dell'iscrizione non genera eventi e il test resterebbe in attesa.
 */
export async function gotoSubscribed(page: Page, url: string) {
  const subscribed = new Promise<void>((resolve) => {
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (String(payload).includes('Subscribed to PostgreSQL')) resolve();
      });
    });
  });
  await page.goto(url);
  await subscribed;
}

/**
 * Tiene il conto delle richieste RSC (router.refresh, navigazioni) e delle server action della pagina.
 * `waitQuiet` attende che nessuna sia in volo e nessuna sia partita negli ultimi `quietMs`: se la rete
 * cade mentre un refresh e' in volo, Next ripiega su una navigazione completa (pagina offline del
 * worker). Il refresh Realtime parte 800 ms dopo l'evento (DEBOUNCE_MS in useRealtimeRefresh).
 * I prefetch non contano: se falliscono non navigano.
 */
export function trackRsc(page: Page) {
  let inflight = 0;
  let last = Date.now();
  const counts = (r: Request) => {
    const h = r.headers();
    return (h['rsc'] === '1' && !h['next-router-prefetch']) || 'next-action' in h;
  };
  page.on('request', (r) => {
    if (!counts(r)) return;
    inflight++;
    last = Date.now();
  });
  const settle = (r: Request) => {
    if (!counts(r)) return;
    inflight = Math.max(0, inflight - 1);
    last = Date.now();
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  return {
    async waitQuiet(quietMs = 2_000) {
      await expect.poll(() => inflight === 0 && Date.now() - last >= quietMs, { timeout: 20_000, intervals: [250] }).toBe(true);
    },
  };
}
