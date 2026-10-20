import { ingredientToText, isoMinutes } from './export';
import type { Ingredient, Step } from './types';

/** Safe subset of a recipe returned by public.get_public_recipe() to anonymous visitors. */
export interface PublicRecipe {
  id: string;
  slug: string;
  title: string;
  description: string;
  original_language: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  category_slug: string | null;
  source_name: string | null;
  source_url: string | null;
  author_name: string | null;
  author_username: string | null;
  cover_image_id: string | null;
  cover_alt: string | null;
  cover_kind: 'upload' | 'imported' | 'ai_generated' | null;
  cover_attribution: string | null;
  created_at: string;
  updated_at: string;
}

export function publicRecipePath(slug: string): string {
  return `/r/${slug}`;
}

export function publicRecipeUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${publicRecipePath(slug)}`;
}

export function publicImageUrl(siteUrl: string, imageId: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/public-images/${imageId}`;
}

/** First ~160 chars of the description, or of the first ingredients as a fallback. */
export function metaDescription(r: Pick<PublicRecipe, 'description' | 'ingredients'>, max = 160): string {
  const src = r.description.trim() || r.ingredients.slice(0, 8).map((i) => i.name).join(', ');
  const flat = src.replace(/\s+/g, ' ');
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** schema.org/Recipe for search engines. Times in ISO 8601; absent fields are left out. */
export function buildRecipeJsonLd(r: PublicRecipe, opts: { siteUrl: string; categoryName?: string | null }) {
  const url = publicRecipeUrl(opts.siteUrl, r.slug);
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    '@id': url,
    mainEntityOfPage: url,
    name: r.title,
    description: r.description || undefined,
    inLanguage: r.original_language,
    image: r.cover_image_id ? [publicImageUrl(opts.siteUrl, r.cover_image_id)] : undefined,
    author: r.author_name ? { '@type': 'Person', name: r.author_name } : undefined,
    datePublished: r.created_at,
    dateModified: r.updated_at,
    prepTime: isoMinutes(r.prep_minutes),
    cookTime: isoMinutes(r.cook_minutes),
    totalTime: isoMinutes(r.total_minutes),
    recipeYield: r.servings ? String(Number(r.servings)) : undefined,
    recipeCategory: opts.categoryName ?? undefined,
    keywords: r.tags.length ? r.tags.join(', ') : undefined,
    recipeIngredient: r.ingredients.map(ingredientToText),
    recipeInstructions: r.steps.map((s) => ({ '@type': 'HowToStep', text: s.text })),
  };
}

/** JSON for an inline <script type="application/ld+json">: "<" is escaped so content cannot close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}
