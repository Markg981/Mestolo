import { expect, test, type Page } from '@playwright/test';

// Lista della spesa dell'utente principale: i passi dipendono l'uno dall'altro.
test.describe.configure({ mode: 'serial' });

/** Il pulsante "Aggiungi" della barra di navigazione ha lo stesso nome: si cerca dentro il form. */
async function addItem(page: Page, line: string) {
  const form = page.locator('form').filter({ has: page.getByLabel('Aggiungi un prodotto') });
  await form.getByLabel('Aggiungi un prodotto').fill(line);
  await form.getByRole('button', { name: 'Aggiungi', exact: true }).click();
}

test.describe('lista della spesa', () => {
  let name: string;

  test.beforeAll(async ({}, testInfo) => {
    // Un'unica parola, unica per progetto ed esecuzione (chromium e mobile condividono l'utente)
    name = `zucca${testInfo.project.name}${Date.now().toString(36)}`;
  });

  test('aggiunge un prodotto a mano', async ({ page }) => {
    await page.goto('/shopping');
    await expect(page.getByRole('heading', { level: 1, name: 'Lista della spesa' })).toBeVisible();
    await addItem(page, `200 g ${name}`);
    await expect(page.getByRole('status').filter({ hasText: 'Aggiunto.' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Da comprare \(\d+\)$/ })).toBeVisible();
  });

  test('somma le voci con stesso nome e unita', async ({ page }) => {
    await page.goto('/shopping');
    await addItem(page, `200 g ${name}`);
    await expect(page.getByRole('status').filter({ hasText: 'Sommato alla voce già presente.' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: new RegExp(`400\\s*g\\s*${name}`) })).toBeVisible();
  });

  test('spunta il prodotto, lo sposta tra i presi e lo rimette da comprare', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    await expect(page.getByRole('heading', { name: /^Presi \(\d+\)$/ })).toBeVisible();
    await page.reload();
    // Lo stato e' persistito sul server
    await expect(page.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();

    await page.getByRole('checkbox', { name: new RegExp(name) }).uncheck();
    await expect(page.getByRole('checkbox', { name: new RegExp(name) })).not.toBeChecked();
  });

  test('cambia il reparto e la scelta resta dopo il ricaricamento', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByLabel(`Reparto di ${name}`).selectOption('household');
    await expect(page.getByLabel(`Reparto di ${name}`)).toHaveValue('household');
    await page.reload();
    await expect(page.getByLabel(`Reparto di ${name}`)).toHaveValue('household');
  });

  test('svuota i presi', async ({ page }) => {
    await page.goto('/shopping');
    await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    await expect(page.getByRole('heading', { name: /^Presi \(\d+\)$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Svuota i presi' }).click();
    await expect(page.getByRole('checkbox', { name: new RegExp(name) })).toHaveCount(0);
  });

  test('rimuove un prodotto', async ({ page }) => {
    const other = `${name}x`;
    await page.goto('/shopping');
    await addItem(page, `1 ${other}`);
    await expect(page.getByRole('checkbox', { name: new RegExp(other) })).toBeVisible();
    await page.getByRole('button', { name: `Rimuovi ${other}` }).click();
    await expect(page.getByRole('checkbox', { name: new RegExp(other) })).toHaveCount(0);
  });
});
