import { expect, test } from '@playwright/test';
import { logout, newUserPage } from './helpers';
import { draftKeys, requireServiceWorker, userCacheNames } from './helpers-extra';

// Il logout e globale (signOut invalida tutte le sessioni dell'utente): si usano sempre utenti dedicati,
// mai quello condiviso dagli altri spec.
test.describe('pulizia di cache e bozze', () => {
  test.skip(({ isMobile }) => isMobile, 'utente dedicato per ogni test: una sola esecuzione per non saturare i rate limit');

  test('il logout cancella le bozze locali e le cache private', async ({ browser }, testInfo) => {
    const u = await newUserPage(browser, testInfo, 'lc1');
    try {
      // Bozza reale dell'editor (salvata dopo 500 ms di inattivita)
      await u.page.goto('/recipes/new');
      await u.page.getByLabel('Titolo').fill('Bozza da cancellare');
      await expect.poll(() => draftKeys(u.page)).toHaveLength(1);

      // Cache privata (nome come quello creato dal service worker)
      await u.page.evaluate(async () => {
        const c = await caches.open('mestolo-user-e2etest');
        await c.put('/shopping', new Response('copia privata'));
      });
      expect(await userCacheNames(u.page)).toContain('mestolo-user-e2etest');

      await logout(u.page);

      await expect.poll(() => draftKeys(u.page)).toHaveLength(0);
      await expect.poll(() => userCacheNames(u.page)).toEqual([]);
    } finally {
      await u.close();
    }
  });

  test('la cache reale del service worker viene svuotata al logout', async ({ browser }, testInfo) => {
    const u = await newUserPage(browser, testInfo, 'lc2');
    try {
      await u.page.goto('/shopping');
      await requireServiceWorker(u.page);
      await u.page.reload();
      await expect.poll(() => u.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await u.page.goto('/shopping');
      await expect.poll(async () => (await userCacheNames(u.page)).length, { timeout: 15_000 }).toBeGreaterThan(0);

      await logout(u.page);
      await expect.poll(() => userCacheNames(u.page)).toEqual([]);

      // Senza utente noto il worker non serve nulla dalla cache privata: offline compare la pagina di riserva
      await u.page.context().setOffline(true);
      try {
        await u.page.goto('/shopping');
        await expect(u.page.getByRole('heading', { level: 1, name: 'Nessuna connessione' })).toBeVisible();
      } finally {
        await u.page.context().setOffline(false);
      }
    } finally {
      await u.close();
    }
  });

  test('la pagina di login svuota la cache privata ma conserva le bozze', async ({ browser }, testInfo) => {
    const u = await newUserPage(browser, testInfo, 'lc3');
    try {
      await u.page.goto('/recipes/new');
      await u.page.getByLabel('Titolo').fill('Bozza che sopravvive');
      await expect.poll(() => draftKeys(u.page)).toHaveLength(1);
      await u.page.evaluate(async () => {
        const c = await caches.open('mestolo-user-e2etest');
        await c.put('/shopping', new Response('copia privata'));
      });

      // Una sessione scaduta a meta modifica non deve costare la bozza (ClearUserCacheOnMount, keepDrafts)
      const ctx = u.page.context();
      await ctx.clearCookies();
      await u.page.goto('/login');
      await expect(u.page.getByRole('button', { name: 'Accedi' })).toBeVisible();

      await expect.poll(() => userCacheNames(u.page)).toEqual([]);
      expect(await draftKeys(u.page)).toHaveLength(1);
    } finally {
      await u.close();
    }
  });
});
