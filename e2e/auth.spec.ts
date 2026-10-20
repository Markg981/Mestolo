import { expect, test } from '@playwright/test';
import { envUser } from './fixtures';
import { login, logout, randomUser } from './helpers';

// Questi test partono da una sessione vuota
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('autenticazione', () => {
  test('registrazione: mostra l\'avviso di controllo email', async ({ page, isMobile }) => {
    test.skip(isMobile, 'una sola esecuzione, per non saturare i rate limit di registrazione');
    const user = randomUser('signup');
    await page.goto('/signup');
    await page.getByLabel('Nome utente').fill(user.username);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Crea account' }).click();
    await expect(page.getByText('Controlla la tua email')).toBeVisible();
  });

  test('accesso con credenziali errate mostra un errore', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nessuno@example.com');
    await page.getByLabel('Password').fill('password-sbagliata');
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('accesso e uscita', async ({ page }) => {
    const user = envUser('session');
    await login(page, user);
    await expect(page.getByRole('main')).toBeVisible();
    await logout(page);
    // Dopo l'uscita le pagine private rimandano al login
    await page.goto('/recipes');
    await expect(page).toHaveURL(/\/(login|welcome)/);
  });
});
