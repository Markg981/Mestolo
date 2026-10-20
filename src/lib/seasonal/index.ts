import { normalizeText } from '@/lib/recipes/duplicates';
import { SEASONAL_PRODUCTS, type SeasonalProduct } from './data';

export { SEASONAL_PRODUCTS, type SeasonalProduct } from './data';

export type Hemisphere = 'north' | 'south';
export const HEMISPHERE_COOKIE = 'mestolo_hemisphere';

export function isHemisphere(v: unknown): v is Hemisphere {
  return v === 'north' || v === 'south';
}

/** Regions (from Accept-Language such as "pt-BR") that are mostly in the southern hemisphere. */
const SOUTH_REGIONS = new Set(['AR', 'AU', 'BO', 'BR', 'CL', 'NZ', 'PE', 'PY', 'UY', 'ZA', 'ZW', 'MZ', 'AO', 'NA', 'BW']);

/** Hemisphere guessed from an Accept-Language header; defaults to north. The user can override it. */
export function guessHemisphere(acceptLanguage: string | null | undefined): Hemisphere {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim() ?? '';
  const region = first.split(';')[0].split('-')[1]?.toUpperCase();
  return region && SOUTH_REGIONS.has(region) ? 'south' : 'north';
}

/** month: 1..12 (calendar is for the northern hemisphere; south is shifted by 6 months). */
export function effectiveMonth(month: number, hemisphere: Hemisphere): number {
  return hemisphere === 'south' ? ((month + 5) % 12) + 1 : month;
}

export function productsInSeason(month: number, hemisphere: Hemisphere): SeasonalProduct[] {
  const m = effectiveMonth(month, hemisphere);
  return SEASONAL_PRODUCTS.filter((p) => p.months.includes(m));
}

function padded(s: string): string {
  return ` ${normalizeText(s)} `;
}

/** All the synonyms in every language: ingredients may be written in a language other than the UI one. */
const MATCHERS = SEASONAL_PRODUCTS.map((p) => ({
  product: p,
  needles: [...new Set(Object.values(p.names).flat().map((n) => padded(n)).filter((n) => n.trim().length > 0))],
}));

/** The product an ingredient name refers to (whole-word match on normalised text), or null. */
export function matchProduct(ingredientName: string): SeasonalProduct | null {
  const hay = padded(ingredientName);
  let best: { p: SeasonalProduct; len: number } | null = null;
  for (const { product, needles } of MATCHERS) {
    for (const n of needles) {
      if (hay.includes(n) && (!best || n.length > best.len)) best = { p: product, len: n.length };
    }
  }
  return best?.p ?? null;
}

export interface SeasonalRecipeScore {
  /** distinct seasonal products found among the ingredients */
  products: SeasonalProduct[];
  /** ingredients recognised as seasonal / total ingredients */
  seasonalCount: number;
  total: number;
}

export function seasonalIngredients(
  ingredients: { name: string }[],
  month: number,
  hemisphere: Hemisphere,
): SeasonalRecipeScore {
  const inSeason = new Set(productsInSeason(month, hemisphere).map((p) => p.id));
  const found = new Map<string, SeasonalProduct>();
  let seasonalCount = 0;
  for (const ing of ingredients) {
    const p = matchProduct(ing.name);
    if (p && inSeason.has(p.id)) {
      seasonalCount++;
      found.set(p.id, p);
    }
  }
  return { products: [...found.values()], seasonalCount, total: ingredients.length };
}

/** Recipes ranked by distinct seasonal products (ties: share of seasonal ingredients); only those with at least `min`. */
export function rankSeasonalRecipes<T extends { ingredients: { name: string }[] }>(
  recipes: T[],
  month: number,
  hemisphere: Hemisphere,
  opts: { limit?: number; min?: number } = {},
): { recipe: T; score: SeasonalRecipeScore }[] {
  const { limit = 6, min = 1 } = opts;
  return recipes
    .map((recipe) => ({ recipe, score: seasonalIngredients(recipe.ingredients ?? [], month, hemisphere) }))
    .filter((x) => x.score.products.length >= min)
    .sort(
      (a, b) =>
        b.score.products.length - a.score.products.length ||
        b.score.seasonalCount / Math.max(1, b.score.total) - a.score.seasonalCount / Math.max(1, a.score.total),
    )
    .slice(0, limit);
}
