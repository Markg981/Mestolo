import { expect, test } from '@playwright/test';
import { adminClient, createTestRecipe, newUserPage } from './helpers';

test.describe('segnalazioni e moderazione', () => {
  test('un utente segnala, il moderatore nasconde la ricetta, chi non e\' moderatore non entra', async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, 'flusso con tre utenti: una sola esecuzione per non saturare i rate limit');
    const owner = await newUserPage(browser, testInfo, 'mo');
    const reporter = await newUserPage(browser, testInfo, 'mr');
    const mod = await newUserPage(browser, testInfo, 'mm');
    try {
      const title = `Spam E2E ${Date.now().toString(36)}`;
      const recipeId = await createTestRecipe(owner.id, title, 'public');
      // Il ruolo si assegna solo con il service role (un trigger impedisce di darselo da soli)
      const { error } = await adminClient().from('profiles').update({ is_moderator: true }).eq('id', mod.id);
      if (error) throw new Error(`Promozione a moderatore fallita: ${error.message}`);

      // Segnalazione
      await reporter.page.goto(`/recipes/${recipeId}`);
      await reporter.page.getByText('Altre azioni').click();
      await reporter.page.getByRole('button', { name: 'Segnala' }).click();
      const dialog = reporter.page.getByRole('dialog', { name: 'Segnala questa ricetta' });
      await dialog.getByLabel('Motivo').selectOption({ label: 'Spam o pubblicità' });
      await dialog.getByLabel('Dettagli (facoltativo)').fill('Test end-to-end');
      await dialog.getByRole('button', { name: 'Invia segnalazione' }).click();
      await expect(reporter.page.getByText('Segnalazione inviata. Grazie.')).toBeVisible();

      // Chi non e' moderatore vede la 404
      await reporter.page.goto('/moderation');
      await expect(reporter.page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible();

      // Il moderatore nasconde la ricetta
      await mod.page.goto('/moderation');
      await expect(mod.page.getByRole('heading', { level: 1, name: 'Moderazione' })).toBeVisible();
      const report = mod.page.getByRole('listitem').filter({ hasText: title });
      await report.getByRole('button', { name: 'Nascondi la ricetta' }).click();
      const hidden = mod.page.locator('section').filter({ has: mod.page.getByRole('heading', { name: 'Ricette nascoste' }) });
      await expect(hidden.getByText(title)).toBeVisible();

      // Il proprietario vede l'avviso, gli altri non la vedono piu'
      await owner.page.goto(`/recipes/${recipeId}`);
      await expect(owner.page.getByText('Ricetta nascosta dalla moderazione')).toBeVisible();
      await reporter.page.goto('/discover?tab=recent');
      await expect(reporter.page.getByRole('link', { name: title })).toHaveCount(0);
    } finally {
      await owner.close();
      await reporter.close();
      await mod.close();
    }
  });
});
