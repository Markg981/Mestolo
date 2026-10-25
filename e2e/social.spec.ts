import { expect, test } from '@playwright/test';
import { createTestRecipe, newUserPage } from './helpers';

test.describe('amicizie e condivisione', () => {
  test('richiesta, accettazione, ricetta per amici visibile, poi rimozione dell\'amicizia', async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, 'flusso con due utenti: una sola esecuzione per non saturare i rate limit');
    const a = await newUserPage(browser, testInfo, 'sa');
    const b = await newUserPage(browser, testInfo, 'sb');
    try {
      const title = `Segreto E2E ${Date.now().toString(36)}`;
      await createTestRecipe(a.id, title, 'friends');

      // Prima dell'amicizia B non vede la ricetta "Amici" di A
      await b.page.goto(`/u/${a.user.username}`);
      await expect(b.page.getByRole('link', { name: title })).toHaveCount(0);

      // A cerca B e invia la richiesta
      await a.page.goto('/friends');
      await a.page.getByLabel('Cerca utenti').fill(b.user.username);
      await a.page.getByRole('button', { name: 'Cerca', exact: true }).click();
      const result = a.page.getByRole('listitem').filter({ hasText: b.user.username });
      await result.getByRole('button', { name: 'Aggiungi', exact: true }).click();
      await expect(a.page.getByText('Richiesta inviata.')).toBeVisible();

      // B accetta
      await b.page.goto('/friends');
      const request = b.page.getByRole('listitem').filter({ hasText: a.user.username });
      await request.getByRole('button', { name: 'Accetta' }).click();
      // La riga diventa un'amicizia confermata
      await expect(request.getByRole('button', { name: 'Rimuovi amicizia', exact: true })).toBeVisible();

      // Ora B vede la ricetta sul profilo di A
      await b.page.goto(`/u/${a.user.username}`);
      await expect(b.page.getByText('Amico', { exact: true })).toBeVisible();
      await expect(b.page.getByRole('link', { name: title })).toBeVisible();

      // B rimuove l'amicizia: l'accesso alla ricetta e' revocato
      await b.page.goto('/friends');
      await b.page.getByRole('listitem').filter({ hasText: a.user.username }).getByRole('button', { name: 'Rimuovi amicizia', exact: true }).click();
      await expect(b.page.getByText('Non hai ancora amici su Mestolo. Cercali per nome utente.')).toBeVisible();
      await b.page.goto(`/u/${a.user.username}`);
      await expect(b.page.getByRole('link', { name: title })).toHaveCount(0);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
