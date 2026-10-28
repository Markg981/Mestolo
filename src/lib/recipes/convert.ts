import type { Ingredient } from './types';

/**
 * Display-only unit conversion (metric <-> US customary), applied on request.
 * Pure functions: the stored recipe is never modified. Compose with
 * scaleIngredients() by scaling first and converting the result.
 */
export type UnitSystem = 'original' | 'metric' | 'us';
export const UNIT_SYSTEMS: UnitSystem[] = ['original', 'metric', 'us'];

const ML = { ml: 1, cl: 10, dl: 100, l: 1000, tsp: 4.92892, tbsp: 14.78676, fl_oz: 29.57353, cup: 236.58824 } as const;
const G = { mg: 0.001, g: 1, kg: 1000, oz: 28.34952, lb: 453.59237 } as const;

type VolUnit = keyof typeof ML;
type MassUnit = keyof typeof G;
const isVol = (u: string | null): u is VolUnit => !!u && Object.hasOwn(ML, u);
const isMass = (u: string | null): u is MassUnit => !!u && Object.hasOwn(G, u);

interface Density {
  keywords: string[];
  /** g per ml */
  gPerMl: number;
  /** metric target: express volumes of this ingredient as grams (dry/solid goods) */
  weighInMetric: boolean;
  /** accept "<keyword> di/of/de ..." (e.g. "olio di semi") */
  allowOf?: boolean;
}

/** Small explicit density table: only ingredients listed here ever cross volume <-> weight. */
export const DENSITIES: Density[] = [
  { keywords: ['acqua', 'water', 'agua', 'eau', 'wasser', 'água'], gPerMl: 1, weighInMetric: false },
  { keywords: ['latte', 'milk', 'leche', 'lait', 'milch', 'leite'], gPerMl: 1.03, weighInMetric: false },
  { keywords: ['farina', 'flour', 'harina', 'farine', 'mehl'], gPerMl: 0.51, weighInMetric: true },
  { keywords: ['zucchero', 'sugar', 'azucar', 'sucre', 'zucker', 'acucar'], gPerMl: 0.85, weighInMetric: true },
  { keywords: ['burro', 'butter', 'mantequilla', 'beurre', 'butter', 'manteiga'], gPerMl: 0.96, weighInMetric: true },
  { keywords: ['olio', 'oil', 'aceite', 'huile', 'ol', 'oleo', 'azeite'], gPerMl: 0.92, weighInMetric: false, allowOf: true },
  { keywords: ['riso', 'rice', 'arroz', 'riz', 'reis'], gPerMl: 0.79, weighInMetric: true },
  { keywords: ['miele', 'honey', 'miel', 'honig', 'mel'], gPerMl: 1.42, weighInMetric: false },
];

const PREPOSITIONS = new Set(['di', 'd', 'de', 'del', 'della', 'of', 'du', 'von', 'aus', 'da', 'do', 'des']);
const EXCLUDED = /\b(velo|icing|powdered|confectioner|glace|puder|impalpable|impalpavel)\b/;

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const TRAILING_OK = new Set(['oil', 'sugar', 'flour', 'milk', 'water', 'rice']);

export function findDensity(name: string): Density | null {
  const words = normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || EXCLUDED.test(words.join(' '))) return null;
  for (const d of DENSITIES) {
    if (d.keywords.includes(words[0])) {
      if (!d.allowOf && words[1] && PREPOSITIONS.has(words[1])) continue;
      return d;
    }
  }
  // Ordine inglese "olive oil", "brown sugar": il nome base e l'ultima parola.
  const last = words[words.length - 1];
  if (words.length > 1 && !words.some((w) => PREPOSITIONS.has(w))) {
    for (const d of DENSITIES) {
      if (d.keywords.includes(last) && TRAILING_OK.has(last)) return d;
    }
  }
  return null;
}

/** Nearest value on a grid of 1/step fractions (and optionally thirds). */
function snap(n: number, denominators: number[]): number {
  let best = n;
  let bestErr = Infinity;
  for (const d of denominators) {
    const v = Math.round(n * d) / d;
    const err = Math.abs(v - n);
    if (err < bestErr - 1e-9) {
      best = v;
      bestErr = err;
    }
  }
  return best;
}

function roundMetric(n: number): number {
  if (n >= 10) return Math.round(n / 5) * 5;
  if (n >= 1) return Math.round(n * 2) / 2;
  return Math.round(n * 10) / 10;
}

type Result = { quantity: number; unit: string };

/**
 * Errore relativo massimo (6%) tollerato per la conversione massa -> oz (sotto 1 lb). Se
 * l'arrotondamento "da cucina" supera la soglia (es. 4 g -> 0,25 oz = +77%),
 * non si converte e si mantiene l'unita originale.
 */
export const MAX_CONVERSION_ERROR = 0.06;

function withinTolerance(exact: number, r: Result | null, factors: Record<string, number>): Result | null {
  if (!r) return null;
  const f = factors[r.unit];
  if (f === undefined || exact <= 0) return r;
  return Math.abs(r.quantity * f - exact) / exact <= MAX_CONVERSION_ERROR ? r : null;
}

function toMetricMass(grams: number): Result | null {
  return toMetricMassRaw(grams);
}
function toMetricMassRaw(grams: number): Result | null {
  if (grams >= 1000) return { quantity: Math.round(grams / 50) / 20, unit: 'kg' };
  const q = roundMetric(grams);
  return q > 0 ? { quantity: q, unit: 'g' } : null;
}

function toMetricVolume(ml: number): Result | null {
  return toMetricVolumeRaw(ml);
}
function toMetricVolumeRaw(ml: number): Result | null {
  if (ml >= 1000) return { quantity: Math.round(ml / 50) / 20, unit: 'l' };
  const q = roundMetric(ml);
  return q > 0 ? { quantity: q, unit: 'ml' } : null;
}

function toUsVolume(ml: number): Result | null {
  return toUsVolumeRaw(ml);
}
function toUsVolumeRaw(ml: number): Result | null {
  let r: Result;
  if (ml < 14) r = { quantity: snap(ml / ML.tsp, [8]), unit: 'tsp' };
  else if (ml < 59) r = { quantity: snap(ml / ML.tbsp, [2]), unit: 'tbsp' };
  else r = { quantity: snap(ml / ML.cup, [4, 3]), unit: 'cup' };
  return r.quantity > 0 ? r : null;
}

function toUsMass(grams: number): Result | null {
  // Sopra 1 lb l'arrotondamento al quarto di libbra resta quello "da cucina".
  if (grams >= G.lb) return toUsMassRaw(grams);
  return withinTolerance(grams, toUsMassRaw(grams), G);
}
function toUsMassRaw(grams: number): Result | null {
  if (grams >= G.lb) return { quantity: snap(grams / G.lb, [4]), unit: 'lb' };
  const oz = grams / G.oz;
  const q = oz < 4 ? snap(oz, [4]) : oz < 16 ? snap(oz, [2]) : Math.round(oz);
  return q > 0 ? { quantity: q, unit: 'oz' } : null;
}

function convertValue(q: number, unit: string, name: string, system: 'metric' | 'us'): Result | null {
  const density = findDensity(name);
  if (system === 'metric') {
    if (isMass(unit)) {
      if (unit === 'g' || unit === 'kg' || unit === 'mg') return null; // already metric
      return toMetricMass(q * G[unit]);
    }
    if (isVol(unit)) {
      if (unit === 'ml' || unit === 'l' || unit === 'cl' || unit === 'dl') return null;
      const ml = q * ML[unit];
      return density?.weighInMetric ? toMetricMass(ml * density.gPerMl) : toMetricVolume(ml);
    }
    return null;
  }
  if (isMass(unit)) {
    if (unit === 'oz' || unit === 'lb') return null;
    const grams = q * G[unit];
    return density ? toUsVolume(grams / density.gPerMl) : toUsMass(grams);
  }
  if (isVol(unit)) {
    if (unit === 'tsp' || unit === 'tbsp' || unit === 'cup' || unit === 'fl_oz') return null;
    return toUsVolume(q * ML[unit]);
  }
  return null;
}

export interface ConvertedIngredient {
  ingredient: Ingredient;
  /** true when quantity/unit were changed for display */
  converted: boolean;
}

/**
 * Convert one ingredient to the requested system. Returns the input untouched
 * for "original", to-taste items, missing quantities, unknown units, or when no
 * safe conversion exists.
 */
export function convertIngredient(ing: Ingredient, system: UnitSystem): ConvertedIngredient {
  const same = { ingredient: ing, converted: false };
  if (system === 'original' || ing.toTaste || ing.quantity === null || !ing.unit) return same;
  const first = convertValue(ing.quantity, ing.unit, ing.name, system);
  if (!first) return same;
  let quantityMax = ing.quantityMax ?? null;
  if (quantityMax) {
    const second = convertValue(quantityMax, ing.unit, ing.name, system);
    if (!second || second.unit !== first.unit) return same;
    quantityMax = second.quantity;
  }
  return { ingredient: { ...ing, quantity: first.quantity, quantityMax, unit: first.unit }, converted: true };
}

export function convertIngredients(ingredients: Ingredient[], system: UnitSystem): ConvertedIngredient[] {
  return ingredients.map((i) => convertIngredient(i, system));
}

const VULGAR: Record<string, string> = {
  '0.1': '⅒', '0.111': '⅑', '0.125': '⅛', '0.143': '⅐', '0.167': '⅙', '0.2': '⅕', '0.25': '¼', '0.333': '⅓',
  '0.375': '⅜', '0.4': '⅖', '0.5': '½', '0.6': '⅗', '0.625': '⅝', '0.667': '⅔', '0.75': '¾', '0.8': '⅘',
  '0.833': '⅚', '0.875': '⅞',
};

/** Kitchen-friendly rendering for US quantities: 1.5 -> "1 ½", 0.333 -> "⅓". */
export function formatFractionQuantity(q: number): string {
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  if (frac < 0.01) return String(whole);
  const key = (Math.round(frac * 1000) / 1000).toFixed(3).replace(/0+$/, '');
  const glyph = VULGAR[key];
  if (!glyph) return String(Math.round(q * 100) / 100);
  return whole ? `${whole} ${glyph}` : glyph;
}

/** Convert temperatures like "180 °C" / "350°F" / "350-375°F" (both range ends) inside free text. Rounded to 5 degrees (25 °F for ovens). */
export function convertTemperatures(text: string, system: UnitSystem): string {
  if (system === 'original') return text;
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(-|–|—|\bto\b|\ba\b)\s*(\d+(?:[.,]\d+)?))?\s*°\s*([CcFf])(?![A-Za-z])/g;
  return text.replace(re, (match, n1: string, sep: string | undefined, n2: string | undefined, u: string) => {
    const isC = u.toUpperCase() === 'C';
    let conv: (v: number) => number;
    let unit: string;
    if (system === 'us' && isC) {
      conv = (v) => {
        const f = (v * 9) / 5 + 32;
        return f >= 250 ? Math.round(f / 25) * 25 : Math.round(f / 5) * 5;
      };
      unit = '°F';
    } else if (system === 'metric' && !isC) {
      conv = (v) => Math.round(((v - 32) * 5) / 9 / 5) * 5;
      unit = '°C';
    } else {
      return match;
    }
    const c1 = conv(parseFloat(n1.replace(',', '.')));
    if (n2 === undefined || sep === undefined) return `${c1} ${unit}`;
    const c2 = conv(parseFloat(n2.replace(',', '.')));
    return `${c1}${/^[a-z]/i.test(sep) ? ` ${sep} ` : sep}${c2} ${unit}`;
  });
}

/**
 * Quantita' in unita' base per confrontare/sommare importi: ml per i volumi,
 * g per le masse, `unit:<u>` (conteggio/altro) solo per unita' identiche.
 * Nessun passaggio volume <-> massa (serve la densita'): dimensioni diverse,
 * il chiamante non deve combinare i valori.
 */
export function toBaseAmount(quantity: number, unit: string | null): { dim: string; amount: number } {
  const u = (unit ?? '').trim().toLowerCase();
  if (isVol(u)) return { dim: 'vol', amount: quantity * ML[u] };
  if (isMass(u)) return { dim: 'mass', amount: quantity * G[u] };
  return { dim: `unit:${u}`, amount: quantity };
}

/** Converte un importo in unita' base nell'unita' indicata (stessa dimensione). */
export function fromBaseAmount(amount: number, unit: string | null): number {
  const u = (unit ?? '').trim().toLowerCase();
  if (isVol(u)) return amount / ML[u];
  if (isMass(u)) return amount / G[u];
  return amount;
}
