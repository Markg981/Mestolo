import { expect, test } from '@playwright/test';
import { adminClient, createTestRecipe, newUserPage } from './helpers';

test.describe('eliminazione dell\'account', () => {
  test('elimina account e dati, poi l\'accesso non funziona piu\'', async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, 'una sola esecuzione: crea e cancella un utente');
    const u = await newUserPage(browser, testInfo, 'del');
    try {
      const recipeId = await createTestRecipe(u.id, `Addio E2E ${Date.now().toString(36)}`, 'private');

      await u.page.goto('/settings/account');
      await expect(u.page.getByRole('heading', { name: "Elimina l'account" })).toBeVisible();
      const button = u.page.getByRole('button', { name: 'Elimina definitivamente' });
      // Il pulsante resta disabilitato finche' il nome utente non coincide
      await u.page.getByLabel(/Per confermare scrivi il tuo nome utente/).fill('sbagliato');
      await expect(button).toBeDisabled();
      await u.page.getByLabel(/Per confermare scrivi il tuo nome utente/).fill(u.user.username);
      await button.click();

      await expect(u.page).toHaveURL(/\/welcome\?deleted=1/);
      await expect(u.page.getByText('Il tuo account e tutti i tuoi dati sono stati eliminati.')).toBeVisible();

      // Dati cancellati a cascata
      const admin = adminClient();
      const { data: recipe } = await admin.from('recipes').select('id').eq('id', recipeId).maybeSingle();
      expect(recipe).toBeNull();
      const { data: profile } = await admin.from('profiles').select('id').eq('id', u.id).maybeSingle();
      expect(profile).toBeNull();

      // Le credenziali non valgono piu'
      await u.page.goto('/login');
      await u.page.getByLabel('Email').fill(u.user.email);
      await u.page.getByLabel('Password').fill(u.user.password);
      await u.page.getByRole('button', { name: 'Accedi' }).click();
      await expect(u.page.getByRole('alert')).toContainText('Email o password non corrette.');
      await expect(u.page).toHaveURL(/\/login/);
    } finally {
      await u.close();
    }
  });
});
