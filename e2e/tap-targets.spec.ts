import { expect, test } from '@playwright/test';

// Aree cliccabili ≥ 44 × 44 px (README, Accessibilità). Misura i controlli visibili delle pagine principali
// su mobile. Esenti, come da WCAG 2.5.5: link dentro un testo e controlli il cui <label> raggiunge già i 44 px.
const PAGES = ['/', '/recipes', '/recipes/new', '/discover', '/shopping', '/plan', '/pantry', '/settings', '/import/text', '/import/link', '/collections', '/friends', '/settings/ai', '/settings/account', '/settings/feedback'];
const MIN = 44;

test.describe('aree cliccabili', () => {
  test.skip(({ isMobile }) => !isMobile, 'misurate solo sul progetto mobile');

  for (const path of PAGES) {
    test(`≥ ${MIN} px in ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const small = await page.evaluate((min) => {
        const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]';
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(selector)) {
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          let box = el.getBoundingClientRect();
          // non visibile (es. skip link fuori schermo prima del focus)
          if (box.width <= 1 || box.height <= 1 || box.right <= 0 || box.left >= innerWidth) continue;
          if (el.tagName === 'A' && el.closest('p')) continue;
          // "stretched link" (after:absolute after:inset-0): l'area cliccabile è il contenitore posizionato
          if (getComputedStyle(el, '::after').position === 'absolute' && el.offsetParent) box = el.offsetParent.getBoundingClientRect();
          // area utile: il campo o il suo <label>, se più grande (es. checkbox dentro un'etichetta)
          const label = el instanceof HTMLInputElement ? el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null) : null;
          const lb = label?.getBoundingClientRect();
          const width = Math.max(box.width, lb?.width ?? 0);
          const height = Math.max(box.height, lb?.height ?? 0);
          if (width + 0.5 < min || height + 0.5 < min) {
            const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
            const type = el instanceof HTMLInputElement ? `[${el.type}]` : '';
            out.push(`${el.tagName.toLowerCase()}${type} "${name}" ${Math.round(box.width)}×${Math.round(box.height)} @${Math.round(box.left)},${Math.round(box.top)} .${el.className.toString().slice(0, 80)}`);
          }
        }
        return out;
      }, MIN);
      expect(small, `controlli sotto i ${MIN} px in ${path}`).toEqual([]);
    });
  }
});
