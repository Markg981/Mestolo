import { expect, test } from '@playwright/test';
import { gotoSubscribed, trackRsc } from './helpers-extra';

// Lista della spesa senza rete (A-10): la spunta fallita non deve portare alla pagina d'errore.
test.describe('lista della spesa offline', () => {
  test('la spunta senza rete mostra un avviso e la pagina resta usabile', async ({ page, context }) => {
    const item = `Pomodori offline ${Date.now()}`;
    const rsc = trackRsc(page);
    // Iscritti al canale Realtime: l'evento dell'aggiunta arriva sempre e il suo refresh si puo attendere.
    await gotoSubscribed(page, '/shopping');
    await page.locator('#newitem').fill(item);
    // Enter invia il form: su mobile c'e' anche il pulsante "Aggiungi" della barra in basso.
    await page.locator('#newitem').press('Enter');
    await expect(page.getByText(item)).toBeVisible();
    // Offline solo a refresh conclusi (quello dell'azione e quello Realtime): un refresh in volo che fallisce
    // farebbe navigare la pagina e il clic sotto finirebbe sulla pagina offline.
    await rsc.waitQuiet();

    await context.setOffline(true);
    // click, non check: dopo l'errore la spunta torna indietro e check() riproverebbe all'infinito.
    await page.getByRole('checkbox', { name: new RegExp(item) }).click();

    // Non /offline/ generico: anche il banner globale "Sei offline" e' un role=status.
    await expect(page.getByRole('status').filter({ hasText: /modifica non .* salvata/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lista della spesa' })).toBeVisible();
    await expect(page.getByText(item)).toBeVisible();

    await context.setOffline(false);
  });
});
