import type { Page } from '@playwright/test';

/** Soglia minima dell'area cliccabile in px (README, Accessibilità; WCAG 2.5.5). */
export const MIN_TAP = 44;

/**
 * Restituisce la descrizione dei controlli visibili della pagina corrente sotto MIN_TAP px.
 * Esenti: link dentro un testo (<p> o la frase di un <label>), "stretched link" (misurato sul contenitore) e campi
 * il cui <label> raggiunge già la soglia.
 */
export async function findSmallTargets(page: Page, min = MIN_TAP): Promise<string[]> {
  return page.evaluate((min) => {
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]';
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let box = el.getBoundingClientRect();
      // non visibile (es. skip link fuori schermo prima del focus)
      if (box.width <= 1 || box.height <= 1 || box.right <= 0 || box.left >= innerWidth) continue;
      if (el.tagName === 'A' && el.closest('p, label')) continue;
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
  }, min);
}
