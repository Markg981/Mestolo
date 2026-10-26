import { expect, test } from '@playwright/test';
import { createTestRecipe, newUserPage } from './helpers';

// Piano pasti dell'utente principale con voci a testo libero: i passi dipendono l'uno dall'altro.
test.describe.configure({ mode: 'serial' });

test.describe('piano pasti', () => {
  let title: string;

  test.beforeAll(async ({}, testInfo) => {
    title = `Cena fuori ${testInfo.project.name} ${Date.now().toString(36)}`;
  });

  test('aggiunge una voce a testo libero a cena', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByRole('heading', { level: 1, name: 'Piano pasti' })).toBeVisible();
    await page.getByRole('button', { name: /^Aggiungi a Cena, / }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Cosa mangi').fill(title);
    await dialog.getByRole('button', { name: 'Aggiungi', exact: true }).click();
    await expect(page.locator('[data-cell-slot="dinner"]').filter({ hasText: title })).toHaveCount(1);
  });

  test('sposta la voce a pranzo', async ({ page }) => {
    await page.goto('/plan');
    await page.getByRole('button', { name: `Sposta ${title} in un altro giorno o pasto` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Pasto').selectOption('lunch');
    await dialog.getByRole('button', { name: 'Sposta', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: new RegExp(`${title} spostato in Pranzo`) })).toBeVisible();
    await expect(page.locator('[data-cell-slot="lunch"]').filter({ hasText: title })).toHaveCount(1);
    await expect(page.locator('[data-cell-slot="dinner"]').filter({ hasText: title })).toHaveCount(0);
  });

  test('la voce resta dopo il ricaricamento e non compare nella settimana successiva', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByText(title)).toBeVisible();
    await page.getByRole('link', { name: 'Settimana successiva' }).click();
    await expect(page).toHaveURL(/\/plan\?week=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByText(title)).toHaveCount(0);
    await page.getByRole('link', { name: 'Questa settimana' }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('rimuove la voce', async ({ page }) => {
    await page.goto('/plan');
    await page.getByRole('button', { name: `Rimuovi ${title}` }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test('gli ingredienti della settimana finiscono nella lista della spesa', async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, 'flusso con utente dedicato: una sola esecuzione per non saturare i rate limit');
    const u = await newUserPage(browser, testInfo, 'plan');
    try {
      const recipe = `Torta piano ${Date.now().toString(36)}`;
      await createTestRecipe(u.id, recipe, 'private'); // ingrediente: farina, 100 g
      await u.page.goto('/plan');
      // Senza ricette pianificate il pulsante e' disabilitato
      await expect(u.page.getByRole('button', { name: 'Ingredienti della settimana nella lista' })).toBeDisabled();

      await u.page.getByRole('button', { name: /^Aggiungi a Cena, / }).first().click();
      const dialog = u.page.getByRole('dialog');
      await dialog.getByLabel('Ricetta (tue e preferite)').selectOption({ label: recipe });
      await dialog.getByRole('button', { name: 'Aggiungi', exact: true }).click();
      await expect(u.page.getByRole('link', { name: recipe })).toBeVisible();

      await u.page.getByRole('button', { name: 'Ingredienti della settimana nella lista' }).click();
      await expect(u.page.getByRole('status').filter({ hasText: /nuovi articoli/ })).toBeVisible();

      await u.page.getByRole('link', { name: 'Apri la lista della spesa' }).click();
      await expect(u.page).toHaveURL(/\/shopping/);
      await expect(u.page.getByRole('checkbox', { name: /farina/ })).toBeVisible();
    } finally {
      await u.close();
    }
  });
});
