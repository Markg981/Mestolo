import { expect, test } from '@playwright/test';

test('cambia la lingua dell\'interfaccia e la ripristina', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();

  // Il nome del select segue la lingua corrente: "Lingua" o "Language"
  const select = page.getByRole('combobox', { name: /^(Lingua|Language)$/ });
  // Se la scelta arriva prima dell'idratazione React non vede il change: si riprova
  const choose = async (label: string, heading: string) => {
    await expect(async () => {
      await select.selectOption({ label });
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  };
  try {
    await choose('English', 'Settings');
  } finally {
    // Ripristina la lingua per non influenzare gli altri test (la scelta e' salvata nel profilo)
    await choose('Italiano', 'Impostazioni');
  }
});
