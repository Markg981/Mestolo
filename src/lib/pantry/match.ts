import { normalizeText } from '@/lib/recipes/duplicates';

export const EXPIRING_DAYS = 3;

export type PantryLocation = 'fridge' | 'freezer' | 'pantry';
export const PANTRY_LOCATIONS: PantryLocation[] = ['fridge', 'freezer', 'pantry'];

export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expires_on: string | null; // YYYY-MM-DD
  location: PantryLocation;
  note: string | null;
}

export type ExpiryStatus = 'expired' | 'soon' | 'ok' | 'none';

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Whole days from `today` (YYYY-MM-DD) to the expiry date; negative = already expired; null = no date. */
export function daysUntil(expiresOn: string | null, today: string): number | null {
  if (!expiresOn) return null;
  return dayNumber(expiresOn) - dayNumber(today);
}

export function expiryStatus(expiresOn: string | null, today: string, soonDays = EXPIRING_DAYS): ExpiryStatus {
  const d = daysUntil(expiresOn, today);
  if (d === null) return 'none';
  if (d < 0) return 'expired';
  return d <= soonDays ? 'soon' : 'ok';
}

/** Earliest expiry first; items without a date last; ties by name. */
export function sortByExpiry<T extends { name: string; expires_on: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.expires_on && b.expires_on && a.expires_on !== b.expires_on) return a.expires_on < b.expires_on ? -1 : 1;
    if (a.expires_on && !b.expires_on) return -1;
    if (!a.expires_on && b.expires_on) return 1;
    return a.name.localeCompare(b.name);
  });
}

export interface RecipeIngredientLike {
  name: string;
  toTaste?: boolean;
}

export interface RecipeLike {
  id: string;
  title: string;
  ingredients: RecipeIngredientLike[];
}

export interface RecipeSuggestion {
  recipeId: string;
  title: string;
  total: number;
  have: number;
  /** names of the pantry items used */
  haveNames: string[];
  /** indexes (in recipe.ingredients) of missing ingredients */
  missingIndexes: number[];
  missingNames: string[];
  /** pantry items used that are expired or expiring soon */
  expiringUsed: string[];
  /** score contribution of expiring items (for transparency) */
  urgency: number;
  coverage: number;
}

/**
 * Ranks recipes by what the pantry already covers. Matching is exact on the
 * normalised name (same normalisation as the shopping merge); expired items are
 * not counted as available. "q.b." ingredients are optional: they never count
 * as missing, and count as present only when matched. Recipes with no matched
 * ingredient are excluded.
 */
export function suggestRecipes(recipes: RecipeLike[], pantry: PantryItem[], today: string, soonDays = EXPIRING_DAYS): RecipeSuggestion[] {
  const usable = new Map<string, PantryItem>();
  for (const p of pantry) {
    const key = normalizeText(p.name);
    if (!key) continue;
    const status = expiryStatus(p.expires_on, today, soonDays);
    if (status === 'expired') continue;
    const prev = usable.get(key);
    // keep the soonest-expiring entry for the same name
    if (!prev || (p.expires_on && (!prev.expires_on || p.expires_on < prev.expires_on))) usable.set(key, p);
  }

  const out: RecipeSuggestion[] = [];
  for (const r of recipes) {
    const required = r.ingredients.map((ing, idx) => ({ ing, idx })).filter((x) => !x.ing.toTaste);
    const haveNames: string[] = [];
    const missingIndexes: number[] = [];
    const missingNames: string[] = [];
    const expiringUsed: string[] = [];
    let urgency = 0;
    let have = 0;
    for (const { ing, idx } of r.ingredients.map((ing, idx) => ({ ing, idx }))) {
      const hit = usable.get(normalizeText(ing.name));
      if (hit) {
        if (!ing.toTaste) have++;
        haveNames.push(hit.name);
        if (expiryStatus(hit.expires_on, today, soonDays) === 'soon') {
          expiringUsed.push(hit.name);
          urgency += soonDays + 1 - (daysUntil(hit.expires_on, today) ?? soonDays);
        }
      } else if (!ing.toTaste) {
        missingIndexes.push(idx);
        missingNames.push(ing.name);
      }
    }
    if (haveNames.length === 0) continue;
    const total = required.length;
    out.push({
      recipeId: r.id,
      title: r.title,
      total,
      have,
      haveNames,
      missingIndexes,
      missingNames,
      expiringUsed,
      urgency,
      coverage: total === 0 ? 1 : have / total,
    });
  }

  // Priority: recipes using expiring items, then higher coverage, then fewer missing, then title.
  return out.sort((a, b) => {
    const ae = a.expiringUsed.length > 0 ? 1 : 0;
    const be = b.expiringUsed.length > 0 ? 1 : 0;
    if (ae !== be) return be - ae;
    if (ae && be && a.urgency !== b.urgency && Math.abs(a.coverage - b.coverage) < 0.25) return b.urgency - a.urgency;
    if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    if (a.missingIndexes.length !== b.missingIndexes.length) return a.missingIndexes.length - b.missingIndexes.length;
    return a.title.localeCompare(b.title);
  });
}
