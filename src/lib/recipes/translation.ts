import { z } from 'zod';
import type { Ingredient, RecipeContent, Step } from './types';

/**
 * Only the human-language strings are sent for translation. Quantities and
 * units are NOT part of the payload, so a translation can never alter them:
 * they are re-attached from the original by position.
 */
export interface TranslatablePayload {
  title: string;
  description: string;
  ingredients: { name: string; note: string | null; section: string | null }[];
  steps: { text: string; section: string | null }[];
}

export const translatedPayloadSchema = z.object({
  title: z.string().max(400),
  description: z.string().max(8000),
  ingredients: z.array(z.object({ name: z.string().max(400), note: z.string().max(600).nullable(), section: z.string().max(200).nullable().optional() })),
  steps: z.array(z.object({ text: z.string().max(4000), section: z.string().max(200).nullable().optional() })),
});

export function buildTranslatable(content: Pick<RecipeContent, 'title' | 'description' | 'ingredients' | 'steps'>): TranslatablePayload {
  return {
    title: content.title,
    description: content.description,
    ingredients: content.ingredients.map((i) => ({ name: i.name, note: i.note ?? null, section: i.section ?? null })),
    steps: content.steps.map((s) => ({ text: s.text, section: s.section ?? null })),
  };
}

export class TranslationShapeError extends Error {}

/** Builds the translated view of a recipe. Throws if the shape does not match the original. */
export function mergeTranslation<T extends Pick<RecipeContent, 'title' | 'description' | 'ingredients' | 'steps'>>(
  original: T,
  translated: z.infer<typeof translatedPayloadSchema>,
): T {
  if (translated.ingredients.length !== original.ingredients.length || translated.steps.length !== original.steps.length) {
    throw new TranslationShapeError('Translation does not match the original structure');
  }
  const ingredients: Ingredient[] = original.ingredients.map((orig, i) => ({
    ...orig, // quantity, quantityMax, unit, toTaste stay exactly as in the original
    name: translated.ingredients[i].name || orig.name,
    note: orig.note ? translated.ingredients[i].note ?? orig.note : orig.note,
    section: orig.section ? translated.ingredients[i].section ?? orig.section : orig.section,
  }));
  const steps: Step[] = original.steps.map((orig, i) => ({
    ...orig,
    text: translated.steps[i].text || orig.text,
    section: orig.section ? translated.steps[i].section ?? orig.section : orig.section,
  }));
  return {
    ...original,
    title: translated.title || original.title,
    description: original.description ? translated.description : original.description,
    ingredients,
    steps,
  };
}

const VULGAR: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅑': 1 / 9, '⅒': 1 / 10,
};

/** Numbers found in free text, normalised (1,5 = 1.5, ½ = 1/2 = 0.5) and sorted; ranges like 10-12 yield both ends. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?)|([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g)) {
    const v = m[4] ? VULGAR[m[4]] : m[1] ? Number(m[1]) / Number(m[2]) : Number(m[3].replace(',', '.'));
    if (Number.isFinite(v)) out.push(String(Math.round(v * 1000) / 1000));
  }
  return out.sort();
}

/** True if both texts contain exactly the same multiset of numbers. */
export function sameNumbers(original: string, translated: string): boolean {
  const a = extractNumbers(original);
  const b = extractNumbers(translated);
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/**
 * Times and temperatures inside free text come from the model unchecked. For every
 * text whose numbers differ from the original, fall back to the original text so a
 * wrong number is never cached and shown to other readers.
 */
export function guardTranslatedNumbers(
  original: Pick<RecipeContent, 'title' | 'description' | 'ingredients' | 'steps'>,
  translated: z.infer<typeof translatedPayloadSchema>,
): z.infer<typeof translatedPayloadSchema> {
  const keep = (orig: string, tr: string) => (sameNumbers(orig, tr) ? tr : orig);
  return {
    ...translated,
    title: keep(original.title, translated.title),
    description: keep(original.description, translated.description),
    ingredients: translated.ingredients.map((t, i) => {
      const o = original.ingredients[i];
      return {
        ...t,
        name: o ? keep(o.name, t.name) : t.name,
        note: t.note !== null && o?.note ? keep(o.note, t.note) : t.note,
        section: t.section != null && o?.section ? keep(o.section, t.section) : t.section,
      };
    }),
    steps: translated.steps.map((t, i) => ({ ...t, text: original.steps[i] ? keep(original.steps[i].text, t.text) : t.text })),
  };
}

/** A cached translation is valid only if it was produced from the current content. */
export function isTranslationFresh(cachedSourceHash: string | null | undefined, currentContentHash: string): boolean {
  return !!cachedSourceHash && cachedSourceHash === currentContentHash;
}
