import { expect, test, type Page } from '@playwright/test';
import { serviceWorkerReady, userCacheNames } from './helpers-extra';

// Service worker (public/sw.js): il worker si registra solo in produzione, quindi con `next dev` i test si saltano.
test.describe('offline e service worker', () => {
  /** Apre la pagina e attende che il worker controlli la pagina e conosca l'utente (cache privata creata). */
  async function warmUp(page: Page) {
    await page.goto('/shopping');
    const ready = await serviceWorkerReady(page);
    test.skip(!ready, 'service worker non registrato: serve una build di produzione (npm run build && npm start) o E2E_BASE_URL');
    // clients.claim() nell'activate: dopo un reload la pagina e' controllata
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // "set-user" crea/seleziona la cache privata; la visita online successiva salva la pagina
    await expect.poll(async () => (await userCacheNames(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.goto('/shopping');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          for (const n of await caches.keys()) {
            if (!n.startsWith('mestolo-user-')) continue;
            if (await (await caches.open(n)).match('/shopping')) return true;
          }
          return false;
        }),
      )
      .toBe(true);
  }

  test('il worker e attivo e la pagina offline di riserva e precaricata', async ({ page }) => {
    await page.goto('/');
    const ready = await serviceWorkerReady(page);
    test.skip(!ready, 'service worker non registrato: serve una build di produzione o E2E_BASE_URL');
    // Il nome della cache cambia a ogni VERSION di public/sw.js: si cerca in tutte le cache statiche.
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith('mestolo-static-'));
      for (const n of names) if (await (await caches.open(n)).match('/offline')) return true;
      return false;
    });
    expect(cached).toBe(true);
  });

  test('la lista della spesa gia visitata resta consultabile offline, con il banner', async ({ page, context }) => {
    await warmUp(page);
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Lista della spesa' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Sei offline: vedi l\'ultima copia salvata.' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
    // Tornati online il banner sparisce
    await expect(page.getByText('Sei offline', { exact: false })).toHaveCount(0);
  });

  test('una pagina mai visitata mostra "Nessuna connessione" e Riprova torna online', async ({ page, context }) => {
    await warmUp(page);
    await context.setOffline(true);
    try {
      // /friends non e' tra le pagine memorizzabili nella cache privata
      await page.goto('/friends');
      await expect(page.getByRole('heading', { level: 1, name: 'Nessuna connessione' })).toBeVisible();
      await expect(page.getByText('Questa pagina non è disponibile offline.')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
    await page.getByRole('button', { name: 'Riprova' }).click();
    // "Riprova" ricarica l'URL richiesto (/friends), ora raggiungibile
    await expect(page.getByRole('heading', { level: 1, name: 'Amici' })).toBeVisible();
  });
});
