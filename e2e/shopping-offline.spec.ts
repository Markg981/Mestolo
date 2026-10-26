import { expect, test } from '@playwright/test';

// Lista della spesa senza rete (A-10): la spunta fallita non deve portare alla pagina d'errore.
test.describe('lista della spesa offline', () => {
  test('la spunta senza rete mostra un avviso e la pagina resta usabile', async ({ page, context }) => {
    const item = `Pomodori offline ${Date.now()}`;
    await page.goto('/shopping');
    await page.locator('#newitem').fill(item);
    await page.getByRole('button', { name: /^Aggiungi$/ }).click();
    await expect(page.getByText(item)).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('checkbox', { name: new RegExp(item) }).check();

    await expect(page.getByRole('status').filter({ hasText: /offline/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lista della spesa' })).toBeVisible();
    await expect(page.getByText(item)).toBeVisible();

    await context.setOffline(false);
  });
});
