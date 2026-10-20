import { z } from 'zod';
import { DEFAULT_PREFS, type PlanPrefs } from './generator';
import type { MealSlot } from './week';

const word = z.string().trim().min(1).max(60);

export const prefsSchema = z.object({
  meals: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).min(1).max(4),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  weekdayMaxMinutes: z.number().int().min(5).max(1440).nullable(),
  preferredTags: z.array(word).max(30),
  excludedTags: z.array(word).max(30),
  preferredCategoryIds: z.array(z.uuid()).max(30),
  excludedCategoryIds: z.array(z.uuid()).max(30),
  avoidIngredients: z.array(word).max(50),
  repeatLevel: z.enum(['low', 'medium', 'high']),
  servings: z.number().positive().max(1000).nullable(),
});

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Normalizza (duplicati, ordine) un input gia' validato. */
export function normalizePrefs(p: z.infer<typeof prefsSchema>): PlanPrefs {
  const order: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  return {
    ...p,
    meals: order.filter((m) => p.meals.includes(m)),
    days: uniq(p.days).sort((a, b) => a - b),
    preferredTags: uniq(p.preferredTags.map((t) => t.toLowerCase())),
    excludedTags: uniq(p.excludedTags.map((t) => t.toLowerCase())),
    preferredCategoryIds: uniq(p.preferredCategoryIds),
    excludedCategoryIds: uniq(p.excludedCategoryIds),
    avoidIngredients: uniq(p.avoidIngredients.map((t) => t.toLowerCase())),
  };
}

export interface PrefsRow {
  meals: MealSlot[];
  days: number[];
  weekday_max_minutes: number | null;
  preferred_tags: string[];
  excluded_tags: string[];
  preferred_category_ids: string[];
  excluded_category_ids: string[];
  avoid_ingredients: string[];
  repeat_level: 'low' | 'medium' | 'high';
  servings: number | string | null;
}

export function prefsFromRow(r: PrefsRow | null | undefined): PlanPrefs {
  if (!r) return DEFAULT_PREFS;
  return {
    meals: r.meals,
    days: r.days.map(Number),
    weekdayMaxMinutes: r.weekday_max_minutes,
    preferredTags: r.preferred_tags,
    excludedTags: r.excluded_tags,
    preferredCategoryIds: r.preferred_category_ids,
    excludedCategoryIds: r.excluded_category_ids,
    avoidIngredients: r.avoid_ingredients,
    repeatLevel: r.repeat_level,
    servings: r.servings === null ? null : Number(r.servings),
  };
}

export function prefsToRow(p: PlanPrefs) {
  return {
    meals: p.meals,
    days: p.days,
    weekday_max_minutes: p.weekdayMaxMinutes,
    preferred_tags: p.preferredTags,
    excluded_tags: p.excludedTags,
    preferred_category_ids: p.preferredCategoryIds,
    excluded_category_ids: p.excludedCategoryIds,
    avoid_ingredients: p.avoidIngredients,
    repeat_level: p.repeatLevel,
    servings: p.servings,
  };
}
