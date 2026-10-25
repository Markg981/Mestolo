import { describe, expect, it } from 'vitest';
import { recipeInputSchema, FIELD_FLAGS_MAX, FLAG_KEY_MAX } from '@/lib/recipes/schema';

describe('recipeInputSchema field_flags limits', () => {
  const base = {
    title: 'Pasta',
    servings: null,
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
    ingredients: [],
    steps: [],
    category_id: null,
    tags: [],
  };
  it('accepts valid field_flags', () => {
    expect(recipeInputSchema.safeParse({ ...base, field_flags: { 'ingredients.0.quantity': ['missing'] } }).success).toBe(true);
  });
  it('rejects too many keys', () => {
    const field_flags = Object.fromEntries(Array.from({ length: FIELD_FLAGS_MAX + 1 }, (_, i) => [`k${i}`, ['missing']]));
    expect(recipeInputSchema.safeParse({ ...base, field_flags }).success).toBe(false);
  });
  it('rejects an oversized key', () => {
    expect(recipeInputSchema.safeParse({ ...base, field_flags: { ['k'.repeat(FLAG_KEY_MAX + 1)]: ['missing'] } }).success).toBe(false);
  });
  it('rejects too many flags per key', () => {
    const f = ['missing', 'low_confidence', 'ambiguous', 'ai_estimate', 'missing'];
    expect(recipeInputSchema.safeParse({ ...base, field_flags: { a: f } }).success).toBe(false);
  });
});
