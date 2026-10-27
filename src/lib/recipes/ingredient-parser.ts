import type { Ingredient } from './types';
import { MAX_UNIT_WORDS, TO_TASTE_PATTERNS, normalizeUnit } from './units';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

// A single number: "1", "1,5", "1.5", "1/2", "1 / 2" (OCR), "1 1/2", "1½", "½", "1.000"
const NUM = `(?:\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\s*\\/\\s*\\d+|\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`;
const RANGE_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|a|à|bis|ou|o|or)\\s*(${NUM}))?`, 'i');

/** Units for which "N,ddd" / "N.ddd" is plausibly a thousands group (small units). */
const THOUSANDS_UNITS = new Set(['g', 'mg', 'ml']);

/**
 * Parses a numeric token; returns null if it is not a valid positive number.
 *
 * Separator disambiguation ("0,250", "1,250", "1.000"):
 *  - a leading "0" followed by a separator is always a decimal ("0,250" = 0.25);
 *  - otherwise a single group of exactly 3 digits is ambiguous: it is read as a
 *    thousands separator only with no unit or a small unit (g, mg, ml: "1.000 g" = 1000);
 *    with any other unit (kg, l, cup...) it is decimal ("1,250 kg" = 1.25).
 */
export function parseNumber(token: string, unit?: string | null): number | null {
  const t = token.trim().replace(/\s*\/\s*/g, '/');
  if (!t) return null;
  if (t in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[t];

  // "1½" / "1 ½"
  const uni = t.match(new RegExp(`^(\\d+)\\s*([${FRACTION_CHARS}])$`));
  if (uni) return Number(uni[1]) + UNICODE_FRACTIONS[uni[2]];

  // "1 1/2"
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    return den ? Number(mixed[1]) + Number(mixed[2]) / den : null;
  }
  // "1/2"
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : null;
  }
  // thousands separator "1.000" / "1,000" (exactly groups of 3)
  if (/^[1-9]\d{0,2}([.,]\d{3})+$/.test(t) && (!unit || THOUSANDS_UNITS.has(unit))) {
    return Number(t.replace(/[.,]/g, ''));
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const CONNECTORS = /^(?:di|d'|d’|de|del|della|dei|degli|delle|of|von|vom|do|da|das|dos)\s+/i;
const CONNECTOR_APOS = /^(?:d'|d’)/i;
const BULLET = /^\s*(?:[-–—•*·▪●○◦]|\d+[.)](?=\s+\D))\s*/;

function detectToTaste(text: string): { toTaste: boolean; cleaned: string } {
  let toTaste = false;
  let cleaned = text;
  for (const re of TO_TASTE_PATTERNS) {
    if (re.test(cleaned)) {
      toTaste = true;
      cleaned = cleaned.replace(re, ' ');
    }
  }
  return { toTaste, cleaned: cleaned.replace(/\s{2,}/g, ' ').replace(/[\s,;:]+$/, '').trim() };
}

function splitNameAndNote(text: string): { name: string; note: string | null } {
  let name = text.trim();
  const notes: string[] = [];
  // parenthesised notes
  name = name.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });
  // ", tritata finemente"
  const comma = name.indexOf(',');
  if (comma > 0) {
    const rest = name.slice(comma + 1).trim();
    if (rest) notes.push(rest);
    name = name.slice(0, comma);
  }
  name = name.replace(/\s{2,}/g, ' ').replace(/^[\s:–-]+|[\s:–-]+$/g, '').trim();
  return { name, note: notes.length ? notes.join('; ') : null };
}

function takeUnit(words: string[]): { unit: string | null; rawUnit: string | null; consumed: number } {
  for (let n = Math.min(MAX_UNIT_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ');
    const key = normalizeUnit(candidate);
    if (key) return { unit: key, rawUnit: candidate, consumed: n };
  }
  return { unit: null, rawUnit: null, consumed: 0 };
}

/**
 * Parses a single ingredient line such as "200 g di farina 00 (setacciata)".
 * Missing data is left null and flagged: it is never invented.
 */
export function parseIngredientLine(line: string): Ingredient {
  const raw = line.trim();
  let text = raw.replace(BULLET, '').trim();
  const { toTaste, cleaned } = detectToTaste(text);
  text = cleaned;

  // "1 e 1/2" / "1 and 1/2" -> "1 1/2" (mixed number written with a conjunction)
  text = text.replace(/^(\d+)\s+(?:e|and|et|y|und)\s+(?=\d+\s*\/\s*\d+)/i, '$1 ');
  // "2 x 400 g" / "2 × 400 g": multiplier of N packs; quantity becomes the total (800 g)
  let multiplier = 1;
  const mult = text.match(/^(\d{1,3})\s*[x×]\s*(?=\d)/i);
  if (mult && Number(mult[1]) >= 1) {
    multiplier = Number(mult[1]);
    text = text.slice(mult[0].length);
  }

  let quantity: number | null = null;
  let quantityMax: number | null = null;
  let unit: string | null = null;
  let rest = text;

  // Leading quantity: "200 g farina", "1-2 spicchi d'aglio", "½ cup sugar", "2 uova"
  const lead = text.match(RANGE_RE);
  if (lead && lead[0].trim()) {
    const q = parseNumber(lead[1]);
    const qMax = lead[2] ? parseNumber(lead[2]) : null;
    if (q !== null && q > 0) {
      quantity = q;
      quantityMax = qMax !== null && qMax > q ? qMax : null;
      rest = text.slice(lead[0].length).trim();
      // "200g" (unit glued to number)
      const glued = rest.match(/^([a-zA-Zàèéìòùäöüßçñ.]+)\b(.*)$/);
      const words = rest.split(/\s+/);
      const u = takeUnit(words.map((w) => w.replace(/[.,]$/, '')));
      if (u.unit) {
        unit = u.unit;
        rest = words.slice(u.consumed).join(' ');
      } else if (glued && normalizeUnit(glued[1])) {
        unit = normalizeUnit(glued[1]);
        rest = glued[2];
      }
      rest = rest.replace(CONNECTORS, '').replace(CONNECTOR_APOS, '').trim();
      if (unit) {
        // the unit is only known now: re-read the number with it as context
        quantity = parseNumber(lead[1], unit) ?? quantity;
        if (lead[2]) {
          const m = parseNumber(lead[2], unit);
          quantityMax = m !== null && m > quantity ? m : null;
        }
      }
    }
  } else {
    // Trailing quantity with a recognised unit: "Farina 00 200 g", "Burro: 50 gr"
    const trailing = text.match(new RegExp(`^(.*?)[\\s:]+(${NUM})\\s*([^\\d\\s][^\\s]*(?:\\s[^\\s]+)?)$`, 'i'));
    if (trailing) {
      const u = takeUnit(trailing[3].split(/\s+/).map((w) => w.replace(/[.,]$/, '')));
      const q = u.unit ? parseNumber(trailing[2], u.unit) : null;
      if (u.unit && q !== null && q > 0 && u.consumed === trailing[3].split(/\s+/).length) {
        quantity = q;
        unit = u.unit;
        rest = trailing[1];
      }
    }
    if (quantity === null) {
      // "Uova: 2"
      const colon = text.match(new RegExp(`^(.*?):\\s*(${NUM})$`));
      if (colon) {
        const q = parseNumber(colon[2]);
        if (q !== null && q > 0) {
          quantity = q;
          rest = colon[1];
        }
      }
    }
  }

  if (multiplier !== 1 && quantity !== null) {
    quantity *= multiplier;
    if (quantityMax !== null) quantityMax *= multiplier;
  }

  const { name, note } = splitNameAndNote(rest);
  const ingredient: Ingredient = {
    name: name || text || raw,
    quantity,
    quantityMax,
    unit,
    note,
    toTaste: toTaste || undefined,
    raw,
  };
  if (quantity === null && !toTaste) ingredient.flags = ['missing'];
  return ingredient;
}

export function parseIngredientLines(text: string): Ingredient[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIngredientLine)
    .filter((i) => i.name.length > 0);
}

/** Human formatting of a quantity; never converts units. */
export function formatQuantity(q: number | null | undefined, locale = 'it', qMax?: number | null): string {
  if (q === null || q === undefined) return '';
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: q < 10 ? 2 : 1 });
  return qMax ? `${fmt.format(q)}–${fmt.format(qMax)}` : fmt.format(q);
}
