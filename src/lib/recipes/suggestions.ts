import { z } from 'zod';
import type { FieldFlags, Ingredient, RecipeContent, Step } from './types';

/** Ingredient as produced by an AI provider (validated). */
export const aiIngredientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100000).nullable(),
  unit: z.string().trim().max(40).nullable(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const suggestionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('step_rewrite'),
    stepIndex: z.number().int().min(0),
    before: z.string(),
    after: z.string().trim().min(1).max(2000),
    reason: z.string().max(500),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('ingredient_fix'),
    ingredientIndex: z.number().int().min(0),
    before: z.string(),
    after: aiIngredientSchema,
    reason: z.string().max(500),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('ingredient_add'),
    after: aiIngredientSchema,
    reason: z.string().max(500),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('time_estimate'),
    field: z.enum(['prep_minutes', 'cook_minutes', 'total_minutes']),
    before: z.number().nullable(),
    after: z.number().int().min(0).max(100000),
    reason: z.string().max(500),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('idea'),
    title: z.string().max(200),
    text: z.string().max(1500),
  }),
]);

export type Suggestion = z.infer<typeof suggestionSchema>;

export const analysisSchema = z.object({
  summary: z.string().max(1500).default(''),
  suggestions: z.array(suggestionSchema).max(30),
});
export type Analysis = z.infer<typeof analysisSchema>;

/** Applicable = can be merged into the recipe. Ideas are informational only. */
export function isApplicable(s: Suggestion): boolean {
  return s.type !== 'idea';
}

function ingredientLabel(i: Ingredient): string {
  return [i.quantity ?? '', i.unit ?? '', i.name].filter((x) => x !== '').join(' ').trim();
}

export interface ApplyResult {
  content: RecipeContent;
  fieldFlags: FieldFlags;
  applied: string[];
  skipped: { id: string; reason: 'stale' | 'not_applicable' | 'out_of_range' }[];
}

/**
 * Applies ONLY the selected suggestions to a copy of the recipe content.
 * The original object is never mutated. A suggestion whose "before" no longer
 * matches the current content (the recipe changed since the analysis) is skipped.
 */
export function applySuggestions(
  original: RecipeContent,
  flags: FieldFlags,
  suggestions: Suggestion[],
  selectedIds: string[],
): ApplyResult {
  const selected = new Set(selectedIds);
  const content: RecipeContent = structuredClone(original);
  const fieldFlags: FieldFlags = structuredClone(flags ?? {});
  const applied: string[] = [];
  const skipped: ApplyResult['skipped'] = [];
  const adds: Ingredient[] = [];

  for (const s of suggestions) {
    if (!selected.has(s.id)) continue;
    switch (s.type) {
      case 'idea':
        skipped.push({ id: s.id, reason: 'not_applicable' });
        break;
      case 'step_rewrite': {
        const step: Step | undefined = content.steps[s.stepIndex];
        if (!step) { skipped.push({ id: s.id, reason: 'out_of_range' }); break; }
        if (original.steps[s.stepIndex]?.text.trim() !== s.before.trim()) { skipped.push({ id: s.id, reason: 'stale' }); break; }
        content.steps[s.stepIndex] = { ...step, text: s.after, flags: undefined };
        applied.push(s.id);
        break;
      }
      case 'ingredient_fix': {
        const ing = content.ingredients[s.ingredientIndex];
        if (!ing) { skipped.push({ id: s.id, reason: 'out_of_range' }); break; }
        const orig = original.ingredients[s.ingredientIndex];
        if (orig.name.trim().toLowerCase() !== s.before.trim().toLowerCase() && ingredientLabel(orig).toLowerCase() !== s.before.trim().toLowerCase()) {
          skipped.push({ id: s.id, reason: 'stale' });
          break;
        }
        content.ingredients[s.ingredientIndex] = {
          ...ing,
          name: s.after.name,
          quantity: s.after.quantity,
          unit: s.after.unit,
          note: s.after.note ?? ing.note ?? null,
          flags: undefined,
        };
        applied.push(s.id);
        break;
      }
      case 'ingredient_add':
        adds.push({ name: s.after.name, quantity: s.after.quantity, unit: s.after.unit, note: s.after.note ?? null });
        applied.push(s.id);
        break;
      case 'time_estimate':
        if ((original[s.field] ?? null) !== (s.before ?? null)) { skipped.push({ id: s.id, reason: 'stale' }); break; }
        content[s.field] = s.after;
        fieldFlags[s.field] = ['ai_estimate'];
        applied.push(s.id);
        break;
    }
  }
  content.ingredients.push(...adds);
  return { content, fieldFlags, applied, skipped };
}
