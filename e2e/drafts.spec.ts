import { expect, test } from '@playwright/test';
import { draftKeys } from './helpers-extra';

// Bozze locali (src/lib/drafts.ts): salvate in localStorage con chiave mestolo:draft:<userId>:<nome>.
// Si usa l'utente condiviso del progetto: le bozze vivono solo nel browser del test, nessun dato sul server.
const NEW_DRAFT_KEY = /^mestolo:draft:[0-9a-f-]{36}:new$/;

test.describe('bozze locali', () => {
  test('la bozza della nuova ricetta si ripristina dopo un ricaricamento e si puo scartare', async ({ page }) => {
    const title = `Bozza E2E ${Date.now().toString(36)}`;
    await page.goto('/recipes/new');
    await page.getByLabel('Titolo').fill(title);
    await expect.poll(() => draftKeys(page)).toEqual([expect.stringMatching(NEW_DRAFT_KEY)]);

    await page.reload();
    await expect(page.getByLabel('Titolo')).toHaveValue(title);
    await expect(page.getByText('Abbiamo ripristinato la bozza non salvata.')).toBeVisible();

    await page.getByRole('button', { name: 'Scarta la bozza' }).click();
    await expect(page.getByLabel('Titolo')).toHaveValue('');
    await expect(page.getByText('Abbiamo ripristinato la bozza non salvata.')).toHaveCount(0);
    await expect.poll(() => draftKeys(page)).toEqual([]);
  });

  test('la bozza viene scritta subito quando la scheda si nasconde o si chiude, senza attendere il debounce', async ({ page }) => {
    await page.goto('/recipes/new');
    const title = `Flush E2E ${Date.now().toString(36)}`;
    const result = await page.getByLabel('Titolo').evaluate(async (el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Meno dei 500 ms di debounce: React ha gia' reso il nuovo stato, ma nulla e' ancora stato scritto
      await new Promise((r) => setTimeout(r, 60));
      const drafts = () => Object.keys(localStorage).filter((k) => k.startsWith('mestolo:draft:'));
      const before = drafts().length;
      window.dispatchEvent(new Event('pagehide'));
      const after = drafts().map((k) => localStorage.getItem(k) ?? '');
      return { before, after };
    }, title);
    expect(result.before).toBe(0);
    expect(result.after).toHaveLength(1);
    expect(result.after[0]).toContain(title);
  });

  test('visibilitychange a "hidden" scrive la bozza', async ({ page }) => {
    await page.goto('/recipes/new');
    const title = `Hidden E2E ${Date.now().toString(36)}`;
    const stored = await page.getByLabel('Titolo').evaluate(async (el, value) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      return Object.keys(localStorage)
        .filter((k) => k.startsWith('mestolo:draft:'))
        .map((k) => localStorage.getItem(k) ?? '');
    }, title);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain(title);
  });

  test('avvisa quando la bozza non puo essere salvata nel browser', async ({ page }) => {
    // Archiviazione piena/bloccata: setItem delle bozze lancia un'eccezione
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith('mestolo:draft:')) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.goto('/recipes/new');
    await page.getByLabel('Titolo').fill('Senza spazio');
    await expect(page.getByText('La bozza non può essere salvata nel browser', { exact: false })).toBeVisible();
  });

  test('riprende l\'importazione in revisione dopo un ricaricamento', async ({ page }) => {
    const title = `Torta import ${Date.now().toString(36)}`;
    await page.goto('/import/text');
    await page.getByLabel('Testo della ricetta').fill(`${title}\n\nIngredienti\n200 g farina\n2 uova\n\nProcedimento\n1. Mescola tutto.\n2. Cuoci.`);
    await page.getByRole('button', { name: 'Analizza il testo' }).click();

    // Schermata di revisione: l'editor con i dati importati
    await expect(page.getByText('Controlla i dati prima di salvare')).toBeVisible();
    await expect(page.getByLabel('Titolo')).toHaveValue(title);
    await expect.poll(() => draftKeys(page).then((k) => k.some((x) => x.endsWith(':import-text:pending')))).toBe(true);

    // Ricaricando la pagina di importazione la revisione viene riproposta (non il campo vuoto)
    await page.goto('/import/text');
    await expect(page.getByText('Controlla i dati prima di salvare')).toBeVisible();
    await expect(page.getByLabel('Titolo')).toHaveValue(title);
  });
});
