import { z } from 'zod';

/** Pure nutrition logic: no I/O, safe to import from client and server code. */

export const NUTRITION_SOURCES = ['manual', 'imported', 'ai_estimate'] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

export const NUTRIENT_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'salt_g'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Values PER SERVING. null = not known. */
export type NutritionValues = Record<NutrientKey, number | null>;

export interface RecipeNutrition extends NutritionValues {
  source: NutritionSource;
  updated_at: string;
}

const LIMITS: Record<NutrientKey, number> = {
  energy_kcal: 5000,
  protein_g: 500,
  carbs_g: 500,
  sugars_g: 500,
  fat_g: 500,
  saturated_fat_g: 500,
  fiber_g: 500,
  salt_g: 100,
};
const DECIMALS: Record<NutrientKey, number> = { energy_kcal: 1, protein_g: 1, carbs_g: 1, sugars_g: 1, fat_g: 1, saturated_fat_g: 1, fiber_g: 1, salt_g: 2 };

export const emptyNutrition = (): NutritionValues => ({
  energy_kcal: null, protein_g: null, carbs_g: null, sugars_g: null, fat_g: null, saturated_fat_g: null, fiber_g: null, salt_g: null,
});

export const roundTo = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export function hasAnyValue(v: Partial<Record<NutrientKey, number | null | undefined>>): boolean {
  return NUTRIENT_KEYS.some((k) => typeof v[k] === 'number' && Number.isFinite(v[k]));
}

const nutrientField = (key: NutrientKey) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.number().finite().min(0).max(LIMITS[key]).nullable().transform((n) => (n === null ? null : roundTo(n, DECIMALS[key]))),
  );

const shape = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nutrientField(k)])) as Record<NutrientKey, ReturnType<typeof nutrientField>>;

/** Validation of a set of values: ranges, rounding and the "of which" consistency (sugars <= carbs, saturated <= fat). */
export const nutritionValuesSchema = z
  .object(shape)
  .refine((v) => v.sugars_g === null || v.carbs_g === null || v.sugars_g <= v.carbs_g, { path: ['sugars_g'], message: 'sugars_exceed_carbs' })
  .refine((v) => v.saturated_fat_g === null || v.fat_g === null || v.saturated_fat_g <= v.fat_g, { path: ['saturated_fat_g'], message: 'saturated_exceed_fat' })
  .refine(hasAnyValue, { message: 'empty' });

export function validateNutrition(input: unknown): { ok: true; values: NutritionValues } | { ok: false; field: string } {
  const r = nutritionValuesSchema.safeParse(input);
  if (r.success) return { ok: true, values: r.data as NutritionValues };
  return { ok: false, field: r.error.issues[0]?.path.join('.') || 'empty' };
}

/** Per-serving values multiplied by the number of portions eaten (null stays null). */
export function scaleNutrition(v: NutritionValues, portions: number): NutritionValues {
  const p = Number.isFinite(portions) && portions > 0 ? portions : 1;
  const out = emptyNutrition();
  for (const k of NUTRIENT_KEYS) {
    const n = v[k];
    out[k] = n === null ? null : roundTo(n * p, DECIMALS[k]);
  }
  return out;
}

// ---------- schema.org NutritionInformation ----------

const NUM_UNIT = /(-?\d+(?:[.,]\d+)?)\s*([a-zµμ]*)/i;

function amount(v: unknown): { n: number; unit: string } | null {
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v, unit: '' } : null;
  if (Array.isArray(v)) return amount(v[0]);
  if (typeof v !== 'string') return null;
  const m = v.match(NUM_UNIT);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? { n, unit: m[2].toLowerCase() } : null;
}

function grams(v: unknown): number | null {
  const a = amount(v);
  if (!a) return null;
  switch (a.unit) {
    case '':
    case 'g':
    case 'gr':
    case 'gram':
    case 'grams':
    case 'grammi':
      return a.n;
    case 'mg':
      return a.n / 1000;
    case 'kg':
      return a.n * 1000;
    default:
      return null;
  }
}

function kcal(v: unknown): number | null {
  const a = amount(v);
  if (!a) return null;
  if (a.unit === 'kj') return a.n / 4.184;
  if (a.unit === '' || a.unit.startsWith('kcal') || a.unit.startsWith('cal') || a.unit === 'calories') return a.n;
  return null;
}

/** Salt (g) from sodium (g): salt = sodium x 2.5 */
const saltFromSodium = (sodiumG: number) => sodiumG * 2.5;

/**
 * Reads a schema.org NutritionInformation node (as found in Recipe.nutrition) into per-serving values.
 * Anything missing, malformed or out of range becomes null; returns null when nothing usable is found.
 */
export function parseSchemaOrgNutrition(node: unknown): NutritionValues | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const o = node as Record<string, unknown>;
  const sodium = grams(o.sodiumContent);
  const raw: Record<NutrientKey, number | null> = {
    energy_kcal: kcal(o.calories),
    protein_g: grams(o.proteinContent),
    carbs_g: grams(o.carbohydrateContent),
    sugars_g: grams(o.sugarContent),
    fat_g: grams(o.fatContent),
    saturated_fat_g: grams(o.saturatedFatContent),
    fiber_g: grams(o.fiberContent),
    salt_g: sodium === null ? null : saltFromSodium(sodium),
  };
  const out = emptyNutrition();
  for (const k of NUTRIENT_KEYS) {
    const n = raw[k];
    out[k] = n !== null && n >= 0 && n <= LIMITS[k] ? roundTo(n, DECIMALS[k]) : null;
  }
  if (out.sugars_g !== null && out.carbs_g !== null && out.sugars_g > out.carbs_g) out.sugars_g = null;
  if (out.saturated_fat_g !== null && out.fat_g !== null && out.saturated_fat_g > out.fat_g) out.saturated_fat_g = null;
  return hasAnyValue(out) ? out : null;
}

/** schema.org `nutrition` for JSON-LD (per serving); undefined when there is nothing to publish. */
export function nutritionJsonLd(v: Partial<Record<NutrientKey, number | null>> | null | undefined) {
  if (!v || !hasAnyValue(v)) return undefined;
  const g = (n: number | null | undefined) => (typeof n === 'number' ? `${n} g` : undefined);
  const sodium = typeof v.salt_g === 'number' ? `${roundTo((v.salt_g / 2.5) * 1000, 0)} mg` : undefined;
  return {
    '@type': 'NutritionInformation',
    servingSize: '1 serving',
    calories: typeof v.energy_kcal === 'number' ? `${v.energy_kcal} kcal` : undefined,
    proteinContent: g(v.protein_g),
    carbohydrateContent: g(v.carbs_g),
    sugarContent: g(v.sugars_g),
    fatContent: g(v.fat_g),
    saturatedFatContent: g(v.saturated_fat_g),
    fiberContent: g(v.fiber_g),
    sodiumContent: sodium,
  };
}

// ---------- AI estimate ----------

/** Validates the JSON returned by the AI: out-of-range or inconsistent values are dropped, never "fixed". */
export function parseAiNutrition(raw: unknown): NutritionValues | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out = emptyNutrition();
  for (const k of NUTRIENT_KEYS) {
    const n = o[k];
    out[k] = typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= LIMITS[k] ? roundTo(n, DECIMALS[k]) : null;
  }
  if (out.sugars_g !== null && out.carbs_g !== null && out.sugars_g > out.carbs_g) out.sugars_g = null;
  if (out.saturated_fat_g !== null && out.fat_g !== null && out.saturated_fat_g > out.fat_g) out.saturated_fat_g = null;
  return hasAnyValue(out) ? out : null;
}

export const isNutritionSource = (s: unknown): s is NutritionSource => typeof s === 'string' && (NUTRITION_SOURCES as readonly string[]).includes(s);
