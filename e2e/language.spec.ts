import { expect, test } from '@playwright/test';

test('cambia la lingua dell\'interfaccia e la ripristina', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();

  const select = page.getByLabel('Lingua', { exact: true });
  try {
    await select.selectOption({ label: 'English' });
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  } finally {
    // Ripristina la lingua per non influenzare gli altri test (la scelta e' salvata nel profilo)
    await page.getByLabel('Language', { exact: true }).selectOption({ label: 'Italiano' });
    await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();
  }
});
