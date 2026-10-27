import { expect, test } from '@playwright/test';
import { gotoSubscribed, trackRsc } from './helpers-extra';

// UX-01: senza rete le server action lanciano; dentro una transizione l'errore non deve arrivare all'error
// boundary (si perderebbe lo stato dei form): la pagina resta montata, i campi restano e compare un avviso.
const avviso = /azione non riuscita/i;

test.describe('azioni senza rete', () => {
  test('dispensa: aggiunta fallita mantiene il form e avvisa', async ({ page, context }) => {
    const name = `Farina offline ${Date.now()}`;
    const rsc = trackRsc(page);
    await gotoSubscribed(page, '/pantry');
    await rsc.waitQuiet();
    await page.getByLabel('Nome', { exact: true }).fill(name);

    await context.setOffline(true);
    await page.getByRole('main').getByRole('button', { name: 'Aggiungi', exact: true }).click();

    await expect(page.getByRole('alert').filter({ hasText: avviso })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Dispensa' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue(name);

    await context.setOffline(false);
  });

  test('raccolte: creazione fallita mantiene il nome e avvisa', async ({ page, context }) => {
    const name = `Raccolta offline ${Date.now()}`;
    const rsc = trackRsc(page);
    await gotoSubscribed(page, '/collections');
    await rsc.waitQuiet();
    await page.locator('#cname').fill(name);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Crea', exact: true }).click();

    await expect(page.getByRole('alert').filter({ hasText: avviso })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Raccolte' })).toBeVisible();
    await expect(page.locator('#cname')).toHaveValue(name);

    await context.setOffline(false);
  });

  test('piano pasti: aggiunta fallita lascia la pagina montata', async ({ page, context }) => {
    const title = `Cena offline ${Date.now()}`;
    const rsc = trackRsc(page);
    await gotoSubscribed(page, '/plan');
    await rsc.waitQuiet();
    await page.getByRole('button', { name: /^Aggiungi a Cena, / }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Cosa mangi').fill(title);

    await context.setOffline(true);
    await dialog.getByRole('button', { name: 'Aggiungi', exact: true }).click();

    await expect(page.getByRole('alert').filter({ hasText: avviso })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Piano pasti' })).toBeVisible();

    await context.setOffline(false);
  });
});
