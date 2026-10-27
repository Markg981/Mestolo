import { z } from 'zod';
import { VISIBILITIES } from './types';
import { DIETS, knownDiets } from './diets';

/** Limiti di lunghezza: fonte unica per schema zod ed editor (maxLength). */
export const RECIPE_LIMITS = {
  title: 200,
  description: 4000,
  ingredientName: 200,
  ingredientNote: 300,
  ingredientUnit: 40,
  stepText: 4000,
  personalNote: 10000,
} as const;

const flag = z.enum(['missing', 'low_confidence', 'ambiguous', 'ai_estimate']);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const minutes = z
  .number()
  .int()
  .min(0)
  .max(100000)
  .nullable();

export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(RECIPE_LIMITS.ingredientName),
  quantity: z.number().positive().max(100000).nullable(),
  quantityMax: z.number().positive().max(100000).nullish().transform((v) => v ?? null),
  unit: optText(RECIPE_LIMITS.ingredientUnit),
  note: optText(RECIPE_LIMITS.ingredientNote),
  section: optText(100),
  toTaste: z.boolean().optional(),
  raw: optText(500),
  flags: z.array(flag).max(4).optional(),
});

export const stepSchema = z.object({
  text: z.string().trim().min(1).max(RECIPE_LIMITS.stepText),
  section: optText(100),
  flags: z.array(flag).max(4).optional(),
});

export const FLAG_KEY_MAX = 100;
export const FIELD_FLAGS_MAX = 500;

export const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

export const recipeInputSchema = z.object({
  title: z.string().trim().min(1).max(RECIPE_LIMITS.title),
  description: z.string().trim().max(RECIPE_LIMITS.description).default(''),
  original_language: z.string().regex(LOCALE_RE).default('it'),
  servings: z.number().positive().max(1000).nullable(),
  prep_minutes: minutes,
  cook_minutes: minutes,
  total_minutes: minutes,
  ingredients: z.array(ingredientSchema).max(200),
  steps: z.array(stepSchema).max(200),
  category_id: z.uuid().nullable(),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .max(30)
    .transform((t) => [...new Set(t)]),
  visibility: z.enum(VISIBILITIES).default('private'),
  personal_note: z.string().max(RECIPE_LIMITS.personalNote).optional(),
  field_flags: z
    .record(z.string().max(FLAG_KEY_MAX), z.array(flag).max(4))
    .refine((r) => Object.keys(r).length <= FIELD_FLAGS_MAX)
    .default({}),
  verification_status: z.enum(['verified', 'needs_review']).default('verified'),
  // dichiarate dall'autore, mai verificate
  diet_hints: z
    .array(z.enum(DIETS))
    .max(DIETS.length)
    .transform((d) => knownDiets(d))
    .default([]),
  // provenance (only for new recipes coming from an import)
  source_type: z.enum(['manual', 'photo', 'url', 'text']).default('manual'),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https?:\/\//)
    .nullish()
    .transform((v) => v ?? null),
  source_name: optText(200),
  source_attribution: optText(500),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

/** Removes empty ingredient/step rows that the editor keeps for convenience. */
export function cleanEditorPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.filter((i) => i && typeof i === 'object' && String((i as { name?: unknown }).name ?? '').trim())
      : r.ingredients,
    steps: Array.isArray(r.steps)
      ? r.steps.filter((s) => s && typeof s === 'object' && String((s as { text?: unknown }).text ?? '').trim())
      : r.steps,
  };
}

/**
 * Stato di verifica deciso dal server: il client puo' chiedere 'needs_review' (es. import in blocco),
 * ma non puo' dichiarare 'verified' finche' restano flag che richiedono revisione
 * (flag di campo, di ingredienti o di passaggi).
 */
export function effectiveVerificationStatus(d: Pick<RecipeInput, 'verification_status' | 'field_flags' | 'ingredients' | 'steps'>): 'verified' | 'needs_review' {
  if (d.verification_status === 'needs_review') return 'needs_review';
  const anyFlags =
    Object.values(d.field_flags).some((f) => f.length > 0) ||
    d.ingredients.some((i) => (i.flags?.length ?? 0) > 0) ||
    d.steps.some((s) => (s.flags?.length ?? 0) > 0);
  return anyFlags ? 'needs_review' : 'verified';
}
