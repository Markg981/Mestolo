import { expect, test, type Browser } from '@playwright/test';
import { createTestRecipe, createTestUser, login, randomUser, type TestUser } from './helpers';

// Sincronizzazione Realtime tra due dispositivi dello stesso utente (RealtimeSync nel layout + ShoppingRealtime).
// Richiede che Realtime sia attivo per le tabelle shopping_items, meal_plan_entries e recipes nello staging.
const SYNC_TIMEOUT = 20_000;

async function device(browser: Browser, baseURL: string | undefined, user: TestUser) {
  const context = await browser.newContext({ baseURL, locale: 'it-IT', storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await login(page, user);
  return { context, page };
}

test.describe('realtime tra dispositivi', () => {
  test.skip(({ isMobile }) => isMobile, 'flusso con due contesti: una sola esecuzione per non saturare i rate limit');

  test('una voce aggiunta alla spesa su un dispositivo compare sull\'altro senza ricaricare', async ({ browser }, testInfo) => {
    const user = randomUser('rt1');
    await createTestUser(user);
    const baseURL = testInfo.project.use.baseURL;
    const a = await device(browser, baseURL, user);
    const b = await device(browser, baseURL, user);
    try {
      const name = `basilico${Date.now().toString(36)}`;
      await a.page.goto('/shopping');
      await b.page.goto('/shopping');
      await expect(b.page.getByRole('heading', { level: 1, name: 'Lista della spesa' })).toBeVisible();

      const form = a.page.locator('form').filter({ has: a.page.getByLabel('Aggiungi un prodotto') });
      await form.getByLabel('Aggiungi un prodotto').fill(`1 ${name}`);
      await form.getByRole('button', { name: 'Aggiungi', exact: true }).click();
      await expect(a.page.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible();

      // Nessun reload su B: l'aggiornamento arriva da Realtime (+ router.refresh)
      await expect(b.page.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible({ timeout: SYNC_TIMEOUT });

      // Spuntare su B si riflette su A
      await b.page.getByRole('checkbox', { name: new RegExp(name) }).check();
      await expect(a.page.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked({ timeout: SYNC_TIMEOUT });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('una ricetta creata altrove compare nel ricettario aperto e una voce di piano nel piano', async ({ browser }, testInfo) => {
    const user = randomUser('rt2');
    const id = await createTestUser(user);
    const baseURL = testInfo.project.use.baseURL;
    const a = await device(browser, baseURL, user);
    const b = await device(browser, baseURL, user);
    try {
      // Ricettario: la riga e' inserita lato server (service role), come farebbe un altro dispositivo
      const title = `Realtime ricetta ${Date.now().toString(36)}`;
      await a.page.goto('/recipes');
      await createTestRecipe(id, title, 'private');
      await expect(a.page.getByRole('link', { name: title })).toBeVisible({ timeout: SYNC_TIMEOUT });

      // Piano: B aggiunge una voce libera a cena, A (gia' sul piano) la vede
      const meal = `Pizza realtime ${Date.now().toString(36)}`;
      await a.page.goto('/plan');
      await b.page.goto('/plan');
      await b.page.getByRole('button', { name: /^Aggiungi a Cena, / }).first().click();
      const dialog = b.page.getByRole('dialog');
      await dialog.getByLabel('Cosa mangi').fill(meal);
      await dialog.getByRole('button', { name: 'Aggiungi', exact: true }).click();
      await expect(b.page.getByText(meal)).toBeVisible();
      await expect(a.page.getByText(meal)).toBeVisible({ timeout: SYNC_TIMEOUT });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
