import { expect, test, type Page } from '@playwright/test';

/**
 * Carica il file finche' la pagina reagisce: se l'input riceve il file prima dell'idratazione
 * di React, l'evento change va perso e non compare nulla.
 */
async function uploadUntil(page: Page, json: unknown, ready: () => Promise<void>) {
  await expect(async () => {
    await page.getByLabel('File JSON di Mestolo').setInputFiles({
      name: 'ricetta.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(json)),
    });
    await ready();
  }).toPass({ timeout: 20_000 });
}

// Import senza rete esterna ne' AI: testo (parser euristico lato server) e file JSON (nel browser)
test.describe('importazione', () => {
  test('dal testo incollato: analizza, rivedi e salva', async ({ page }, testInfo) => {
    const title = `Torta E2E ${testInfo.project.name}-${Date.now().toString(36)}`;
    await page.goto('/import/text');
    await expect(page.getByRole('heading', { level: 1, name: 'Incolla il testo' })).toBeVisible();
    await page
      .getByLabel('Testo della ricetta')
      .fill(`${title}\n\nIngredienti\n- 300 g farina\n- 2 uova\n- 100 ml latte\n\nProcedimento\n1. Mescola la farina con le uova.\n2. Aggiungi il latte e cuoci 30 minuti.`);
    await page.getByRole('button', { name: 'Analizza il testo' }).click();

    // Revisione: i dati estratti sono gia' nei campi
    await expect(page.getByText('Controlla i dati prima di salvare')).toBeVisible();
    await expect(page.getByLabel('Titolo')).toHaveValue(title);
    await page.getByRole('button', { name: 'Salva la ricetta' }).click();

    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}\?created=1/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('farina').first()).toBeVisible();
  });

  test('da un file JSON di Mestolo', async ({ page }, testInfo) => {
    const title = `Zuppa E2E ${testInfo.project.name}-${Date.now().toString(36)}`;
    const file = {
      format: 'mestolo.recipe/v1',
      recipe: { title, ingredients: [{ name: 'ceci', quantity: 250, unit: 'g' }], steps: [{ text: 'Cuoci i ceci.' }] },
    };
    await page.goto('/import/file');
    await uploadUntil(page, file, () => expect(page.getByLabel('Titolo')).toHaveValue(title, { timeout: 3_000 }));
    await page.getByRole('button', { name: 'Salva la ricetta' }).click();

    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}\?created=1/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('un file che non e\' un\'esportazione di Mestolo viene rifiutato', async ({ page }) => {
    await page.goto('/import/file');
    // Il testo usa l'apostrofo tipografico (’)
    await uploadUntil(page, { hello: 'world' }, () =>
      expect(page.getByText(/Questo file non è un.esportazione di Mestolo\./)).toBeVisible({ timeout: 3_000 }),
    );
  });
});
