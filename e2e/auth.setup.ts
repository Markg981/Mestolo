import { test as setup } from '@playwright/test';
import { envUser } from './fixtures';
import { login } from './helpers';

/** Accede una volta con l'utente "main" e salva la sessione per gli altri progetti. */
setup('login utente principale', async ({ page }) => {
  await login(page, envUser('main'));
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
