import { z } from 'zod';
import { normalizeUnit } from '@/lib/recipes/units';
import { suggestCategory } from '@/lib/recipes/classify';
import type { FieldFlags, ImportDraft, ImportWarning, Ingredient, Step } from '@/lib/recipes/types';

const num = z.number().nonnegative().max(100000).nullable().catch(null);

const ingredientSchema = z.object({
  name: z.string().max(300),
  quantity: z.number().positive().max(100000).nullable().catch(null),
  unit: z.string().max(60).nullable().catch(null),
  note: z.string().max(300).nullable().optional().catch(null),
  section: z.string().max(100).nullable().optional().catch(null),
  confidence: z.enum(['high', 'low']).catch('low'),
});

const stepSchema = z.object({
  text: z.string().max(4000),
  section: z.string().max(100).nullable().optional().catch(null),
  confidence: z.enum(['high', 'low']).catch('low'),
});

/** Keeps the valid items of an array and counts the dropped ones. */
function parseItems<T>(schema: z.ZodType<T>, items: unknown[]): { valid: T[]; dropped: number } {
  const valid: T[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) valid.push(r.data);
  }
  return { valid, dropped: items.length - valid.length };
}

export const extractionSchema = z.object({
  language: z.string().max(10).nullable().catch(null),
  title: z.string().max(300).nullable().catch(null),
  description: z.string().max(4000).nullable().catch(null),
  servings: num,
  prep_minutes: num,
  cook_minutes: num,
  total_minutes: num,
  // Items are validated one by one in draftFromExtraction so a single bad item doesn't drop the whole array.
  ingredients: z.array(z.unknown()).max(200).catch([]),
  steps: z.array(z.unknown()).max(200).catch([]),
  uncertain: z.array(z.string().max(60)).max(50).catch([]),
  warnings: z
    .array(
      z.object({
        code: z.enum(['missing_page', 'ambiguous_text', 'unreadable']).catch('ambiguous_text'),
        page: z.number().int().nullable().optional().catch(null),
        message: z.string().max(500).optional().catch(''),
      }),
    )
    .max(30)
    .catch([]),
});

/** Converts validated provider output into an import draft. Missing values stay null and are flagged. */
export function draftFromExtraction(raw: unknown, source: ImportDraft['source']): ImportDraft {
  const x = extractionSchema.parse(raw);
  const uncertain = new Set(x.uncertain);
  const parsedIngredients = parseItems(ingredientSchema, x.ingredients);
  const parsedSteps = parseItems(stepSchema, x.steps);
  const ingredients: Ingredient[] = parsedIngredients.valid
    .filter((i) => i.name.trim())
    .map((i) => {
      const unitKey = normalizeUnit(i.unit);
      const flags: Ingredient['flags'] = [];
      if (i.confidence === 'low') flags.push('low_confidence');
      if (i.quantity === null) flags.push('missing');
      return {
        name: i.name.trim(),
        quantity: i.quantity,
        unit: unitKey ?? (i.unit?.trim() || null),
        note: i.note?.trim() || null,
        section: i.section?.trim() || null,
        flags: flags.length ? flags : undefined,
      };
    });
  const steps: Step[] = parsedSteps.valid
    .filter((s) => s.text.trim())
    .map((s) => ({ text: s.text.trim(), section: s.section?.trim() || null, flags: s.confidence === 'low' ? ['low_confidence'] : undefined }));

  const field_flags: FieldFlags = {};
  const mark = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') field_flags[field] = ['missing'];
    else if (uncertain.has(field)) field_flags[field] = ['low_confidence'];
  };
  mark('title', x.title);
  mark('servings', x.servings);
  mark('prep_minutes', x.prep_minutes);
  mark('cook_minutes', x.cook_minutes);
  mark('total_minutes', x.total_minutes);
  if (!ingredients.length) field_flags.ingredients = ['missing'];
  if (!steps.length) field_flags.steps = ['missing'];

  const warnings: ImportWarning[] = x.warnings.map((w) => ({ code: w.code, page: w.page ?? undefined, message: w.message || undefined }));
  if (parsedIngredients.dropped || parsedSteps.dropped) warnings.push({ code: 'invalid_items_dropped' });
  if (!ingredients.length) warnings.push({ code: 'no_ingredients' });
  if (!steps.length) warnings.push({ code: 'no_steps' });

  const title = (x.title ?? '').trim().slice(0, 200);
  const cat = suggestCategory({ title, description: x.description ?? '', ingredients });
  const lang = x.language && /^[a-z]{2}/i.test(x.language) ? x.language.slice(0, 2).toLowerCase() : 'it';

  return {
    content: {
      title,
      description: (x.description ?? '').trim(),
      original_language: lang,
      servings: x.servings && x.servings > 0 ? x.servings : null,
      prep_minutes: x.prep_minutes !== null ? Math.round(x.prep_minutes) : null,
      cook_minutes: x.cook_minutes !== null ? Math.round(x.cook_minutes) : null,
      total_minutes: x.total_minutes !== null ? Math.round(x.total_minutes) : null,
      ingredients,
      steps,
      tags: [],
      category_slug: cat.slug,
    },
    field_flags,
    warnings,
    categoryConfidence: cat.confidence,
    source,
  };
}
