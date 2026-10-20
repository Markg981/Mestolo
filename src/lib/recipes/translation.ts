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

/** A cached translation is valid only if it was produced from the current content. */
export function isTranslationFresh(cachedSourceHash: string | null | undefined, currentContentHash: string): boolean {
  return !!cachedSourceHash && cachedSourceHash === currentContentHash;
}
