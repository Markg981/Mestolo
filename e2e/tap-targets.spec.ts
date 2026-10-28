import { expect, test } from '@playwright/test';
import { createTestRecipe, newUserPage } from './helpers';
import { findSmallTargets, MIN_TAP } from './tap-targets-helper';

// Aree cliccabili ≥ 44 × 44 px (README, Accessibilità). Misura i controlli visibili delle pagine principali
// su mobile (logica riusabile in tap-targets-helper.ts). Esenti, come da WCAG 2.5.5: link dentro un testo
// e controlli il cui <label> raggiunge già i 44 px.
const PAGES = ['/', '/more', '/recipes', '/recipes/new', '/discover', '/shopping', '/plan', '/pantry', '/settings', '/import/text', '/import/link', '/collections', '/friends', '/settings/ai', '/settings/account', '/settings/feedback', '/offline'];
// Pagine pubbliche: si misurano senza sessione.
const PUBLIC_PAGES = ['/welcome', '/login', '/signup', '/forgot-password', '/privacy', '/terms'];

test.describe('aree cliccabili', () => {
  test.skip(({ isMobile }) => !isMobile, 'misurate solo sul progetto mobile');

  for (const path of PAGES) {
    test(`≥ ${MIN_TAP} px in ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await findSmallTargets(page), `controlli sotto i ${MIN_TAP} px in ${path}`).toEqual([]);
    });
  }

  test.describe('senza sessione', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const path of PUBLIC_PAGES) {
      test(`≥ ${MIN_TAP} px in ${path}`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await findSmallTargets(page), `controlli sotto i ${MIN_TAP} px in ${path}`).toEqual([]);
      });
    }
  });

  // Rotte con dati: ricetta pubblica di un utente dedicato, profilo pubblico, stampa e modalità cucina.
  test('≥ 44 px in dettaglio ricetta, cucina, stampa e profilo', async ({ browser }, testInfo) => {
    const owner = await newUserPage(browser, testInfo, 'tap');
    try {
      const id = await createTestRecipe(owner.id, 'e2e-tap-targets', 'public');
      const paths = [`/recipes/${id}`, `/recipes/${id}/cook`, `/print/recipes/${id}`, `/u/${owner.user.username}`];
      for (const path of paths) {
        await owner.page.goto(path);
        await owner.page.waitForLoadState('networkidle');
        expect(await findSmallTargets(owner.page), `controlli sotto i ${MIN_TAP} px in ${path}`).toEqual([]);
      }
    } finally {
      await owner.close();
    }
  });
});
