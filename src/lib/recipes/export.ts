import type { Ingredient, RecipeRow } from './types';

/**
 * Export formats (documented in docs/export-format.md):
 *  - "mestolo.recipe/v1": lossless JSON of a recipe (structured ingredients, flags, provenance)
 *  - schema.org Recipe JSON-LD: portable, readable by many recipe apps and search engines
 */
export const MESTOLO_FORMAT = 'mestolo.recipe/v1';

export interface ExportImage {
  kind: string;
  alt_text: string;
  attribution: string | null;
  source_url: string | null;
}

export function toMestoloJson(
  r: RecipeRow,
  extra: { categorySlug: string | null; categoryName: string | null; images: ExportImage[]; personalNote?: string | null },
) {
  return {
    format: MESTOLO_FORMAT,
    exported_at: new Date().toISOString(),
    recipe: {
      id: r.id,
      title: r.title,
      description: r.description,
      original_language: r.original_language,
      servings: r.servings,
      prep_minutes: r.prep_minutes,
      cook_minutes: r.cook_minutes,
      total_minutes: r.total_minutes,
      ingredients: r.ingredients,
      steps: r.steps,
      category: { slug: extra.categorySlug, name: extra.categoryName },
      tags: r.tags,
      visibility: r.visibility,
      verification_status: r.verification_status,
      field_flags: r.field_flags,
      diet_hints_unverified: r.diet_hints,
      source: {
        type: r.source_type,
        url: r.source_url,
        name: r.source_name,
        attribution: r.source_attribution,
        original_author_name: r.original_author_name,
      },
      version: r.version,
      created_at: r.created_at,
      updated_at: r.updated_at,
      images: extra.images,
      personal_note: extra.personalNote ?? null,
    },
  };
}

export function isoMinutes(min: number | null): string | undefined {
  if (min === null || min === undefined) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
}

export function ingredientToText(i: Ingredient): string {
  const qty = i.quantity !== null ? `${i.quantity}${i.quantityMax ? `-${i.quantityMax}` : ''}` : '';
  const parts = [qty, i.unit ?? '', i.name].filter(Boolean).join(' ');
  const tail = [i.toTaste ? 'q.b.' : '', i.note ?? ''].filter(Boolean).join(', ');
  return tail ? `${parts}, ${tail}` : parts;
}

export function toSchemaOrg(r: RecipeRow, extra: { authorName?: string | null; categoryName?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    description: r.description || undefined,
    inLanguage: r.original_language,
    recipeYield: r.servings ? String(r.servings) : undefined,
    prepTime: isoMinutes(r.prep_minutes),
    cookTime: isoMinutes(r.cook_minutes),
    totalTime: isoMinutes(r.total_minutes),
    recipeCategory: extra.categoryName ?? undefined,
    keywords: r.tags.length ? r.tags.join(', ') : undefined,
    recipeIngredient: r.ingredients.map(ingredientToText),
    recipeInstructions: r.steps.map((s) => ({ '@type': 'HowToStep', text: s.text })),
    author: extra.authorName ? { '@type': 'Person', name: extra.authorName } : undefined,
    isBasedOn: r.source_url ?? undefined,
    dateCreated: r.created_at,
    dateModified: r.updated_at,
  };
}
