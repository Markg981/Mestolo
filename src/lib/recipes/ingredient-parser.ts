import type { Ingredient } from './types';
import { MAX_UNIT_WORDS, TO_TASTE_PATTERNS, normalizeUnit } from './units';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

// A single number: "1", "1,5", "1.5", "1/2", "1 / 2" (OCR), "1 1/2", "1½", "½", "1.000"
const NUM = `(?:\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\s*\\/\\s*\\d+|\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`;
const RANGE_RE = new RegExp(`^(${NUM})(?:\\\s*(?:-|–|—|to|a|à|bis|ou|o|or)\\\s*(${NUM}))?`, 'i');

/** Units for which "N,ddd" / "N.ddd" is plausibly a thousands group (small units). */
const THOUSANDS_UNITS = new Set(['g', 'mg', 'ml', 'kcal', 'kj', 'cal']);

/**
 * Parses a numeric token; returns null if it is not a valid positive number.
 *
 * Separator disambiguation ("0,250", "1,250", "1.000"):
 *  - a leading "0" followed by a separator is always a decimal ("0,250" = 0.25);
 *  - otherwise a single group of exactly 3 digits is ambiguous: it is read as a
 *    thousands separator only with no unit or a small unit (g, mg, ml, kcal, kJ, cal: "1.000 g" = 1000);
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

// Numerals written as words (it, en, es, fr, de, pt). "a"/"an" are English articles, always followed by a word.
const WORD_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, one: 1, a: 1, an: 1, une: 1, ein: 1, eine: 1, einen: 1, um: 1, uma: 1,
  due: 2, two: 2, dos: 2, deux: 2, zwei: 2, dois: 2, duas: 2,
  tre: 3, three: 3, tres: 3, trois: 3, drei: 3, 'três': 3,
  quattro: 4, four: 4, cuatro: 4, quatre: 4, vier: 4, quatro: 4,
  cinque: 5, five: 5, cinco: 5, cinq: 5, 'fünf': 5,
  sei: 6, six: 6, seis: 6, sechs: 6,
  sette: 7, seven: 7, siete: 7, sept: 7, sieben: 7, sete: 7,
  otto: 8, eight: 8, ocho: 8, huit: 8, acht: 8, oito: 8,
  nove: 9, nine: 9, nueve: 9, neuf: 9, neun: 9,
  dieci: 10, ten: 10, diez: 10, dix: 10, zehn: 10, dez: 10,
};
const HALF_WORDS = 'mezzo|mezza|half|medio|media|demi|demie|halb|halbe|halber|halbes|meio|meia';
const ARTICLE_RE = /^(?:a|an|un|une|ein|eine)\s+/i;
const WORD_NUMBER_RE = new RegExp(`^(${Object.keys(WORD_NUMBERS).join('|')}|${HALF_WORDS})(?=\\s)\\s*`, 'i');
const HALF_RE = new RegExp(`^(?:${HALF_WORDS})$`, 'i');
const AND_HALF_RE = new RegExp(`^(?:e|and|et|y|und|i)\\\s+(?:(?:a|an|un|une|ein|eine)\\\s+)?(?:${HALF_WORDS})(?![\\\p{L}])\\\s*`, 'iu');
const NUM_AND_HALF_RE = new RegExp(`^(\\d+)\\s+(?:e|and|et|y|und)\\s+(?:(?:a|an|un|une|ein|eine)\\s+)?(?:${HALF_WORDS})(?![\\p{L}])`, 'iu');

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
  // "-2 g sale": a glued minus sign is a negative quantity, not a bullet ("- 2 g sale" is a bullet)
  const negative = /^[-−]\d/.test(raw);
  let text = (negative ? raw.slice(1) : raw.replace(BULLET, '')).trim();
  const { toTaste, cleaned } = detectToTaste(text);
  text = cleaned;

  // "1 e 1/2" / "1 and 1/2" -> "1 1/2" (mixed number written with a conjunction)
  text = text.replace(/^(\d+)\s+(?:e|and|et|y|und)\s+(?=\d+\s*\/\s*\d+)/i, '$1 ');
  // "1 and a half cups" / "1 e mezzo" -> "1½"
  text = text.replace(NUM_AND_HALF_RE, '$1½');
  // "30g/1oz sugar" / "1 cup/240 ml milk": dual measures, keep the first
  text = text.replace(/^(\d+(?:[.,]\d+)?\s*[a-zA-Z]+)\s*\/\s*\d+(?:[.,]\d+)?\s*[a-zA-Z]+\b/, '$1');
  // Numerals in words: "una cipolla", "mezzo limone", "half a lemon", "due uova"
  const wordNum = text.match(WORD_NUMBER_RE);
  if (wordNum && text.slice(wordNum[0].length).trim()) {
    const w = wordNum[1].toLowerCase();
    const isHalf = HALF_RE.test(w);
    let after = text.slice(wordNum[0].length);
    if (isHalf) after = after.replace(ARTICLE_RE, '');
    text = `${isHalf ? 0.5 : WORD_NUMBERS[w]} ${after}`;
  }
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
  let halfBonus = 0;
  let extraNote: string | null = null;

  // Leading quantity: "200 g farina", "1-2 spicchi d'aglio", "½ cup sugar", "2 uova"
  const lead = text.match(RANGE_RE);
  if (lead && lead[0].trim()) {
    const q = parseNumber(lead[1]);
    const qMax = lead[2] ? parseNumber(lead[2]) : null;
    if (q !== null && q >= 0) {
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
      // "1 cucchiaio e mezzo di miele"
      const andHalf = rest.match(AND_HALF_RE);
      if (andHalf) {
        rest = rest.slice(andHalf[0].length);
        halfBonus = 0.5;
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

  if (quantity !== null && halfBonus) quantity += halfBonus;
  // zero or negative quantities are not meaningful: keep the clean name, drop the amount
  if (quantity !== null && (quantity <= 0 || negative)) {
    quantity = null;
    quantityMax = null;
    unit = null;
  }
  // "2 uova + 1 per spennellare": the extra amount is kept as a note
  const plus = rest.match(/^(.*?)\s+\+\s+(\d.*)$/);
  if (plus) {
    rest = plus[1];
    extraNote = `+ ${plus[2].trim()}`;
  }

  if (multiplier !== 1 && quantity !== null) {
    quantity *= multiplier;
    if (quantityMax !== null) quantityMax *= multiplier;
  }

  const split = splitNameAndNote(rest);
  const name = split.name;
  const note = [split.note, extraNote].filter(Boolean).join('; ') || null;
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
