import { z } from 'zod';
import { VISIBILITIES } from './types';

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
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100000).nullable(),
  quantityMax: z.number().positive().max(100000).nullish().transform((v) => v ?? null),
  unit: optText(40),
  note: optText(300),
  section: optText(100),
  toTaste: z.boolean().optional(),
  raw: optText(500),
  flags: z.array(flag).max(4).optional(),
});

export const stepSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  section: optText(100),
  flags: z.array(flag).max(4).optional(),
});

export const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

export const recipeInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
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
  personal_note: z.string().max(10000).optional(),
  field_flags: z.record(z.string(), z.array(flag)).default({}),
  verification_status: z.enum(['verified', 'needs_review']).default('verified'),
  diet_hints: z.array(z.string().max(40)).max(20).default([]),
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
