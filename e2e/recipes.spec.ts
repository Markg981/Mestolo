import { expect, test } from '@playwright/test';

// Flusso completo su una ricetta: crea, modifica, lista, spesa, piano. I passi dipendono l'uno dall'altro.
test.describe.configure({ mode: 'serial' });

test.describe('ricette, spesa e piano pasti', () => {
  let title: string;
  let editedTitle: string;
  let ingredient: string;

  test.beforeAll(async ({}, testInfo) => {
    // Nome unico per progetto e per esecuzione: chromium e mobile condividono lo stesso utente
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    title = `Pasta E2E ${tag}`;
    editedTitle = `${title} rivista`;
    ingredient = `farina e2e ${tag}`;
  });

  test('crea una ricetta manualmente', async ({ page }) => {
    await page.goto('/recipes/new');
    await page.getByLabel('Titolo').fill(title);
    await page.getByLabel('Porzioni').fill('4');
    await page.getByLabel('Quantità', { exact: true }).first().fill('200');
    await page.getByLabel('Unità', { exact: true }).first().fill('g');
    await page.getByLabel('Ingrediente', { exact: true }).first().fill(ingredient);
    await page.getByLabel('Passaggio 1').fill('Mescola tutto e cuoci.');
    await page.getByRole('button', { name: 'Salva', exact: true }).click();

    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(ingredient)).toBeVisible();
  });

  test('modifica la ricetta', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('link', { name: title }).click();
    await page.getByRole('link', { name: 'Modifica' }).click();
    await page.getByLabel('Titolo').fill(editedTitle);
    await page.getByRole('button', { name: 'Salva', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: editedTitle })).toBeVisible();
  });

  test('la ricetta compare nell\'elenco', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page.getByRole('link', { name: editedTitle })).toBeVisible();
  });

  test('aggiunge gli ingredienti alla lista della spesa', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('link', { name: editedTitle }).click();
    await page.getByRole('button', { name: 'Aggiungi alla lista della spesa' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Aggiunti/ })).toBeVisible();

    await page.goto('/shopping');
    await expect(page.getByRole('heading', { name: 'Lista della spesa' })).toBeVisible();
    await expect(page.getByText(ingredient)).toBeVisible();
  });

  test('pianifica un pasto', async ({ page }) => {
    await page.goto('/recipes');
    await page.getByRole('link', { name: editedTitle }).click();
    await page.getByRole('button', { name: 'Aggiungi al piano' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Pasto').selectOption('dinner');
    await dialog.getByRole('button', { name: 'Aggiungi al piano' }).click();
    await expect(page.getByText('Aggiunta al piano pasti.')).toBeVisible();

    await page.goto('/plan');
    await expect(page.getByRole('link', { name: editedTitle })).toBeVisible();
  });
});
