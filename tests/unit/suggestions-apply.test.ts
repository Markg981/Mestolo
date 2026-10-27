import { describe, expect, it } from 'vitest';
import { applySuggestions, type Suggestion } from '@/lib/recipes/suggestions';
import type { RecipeContent } from '@/lib/recipes/types';

const base = {
  title: 'T',
  description: null,
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: null,
  steps: [],
  ingredients: [{ name: 'Sale', quantity: 1, quantityMax: 2, unit: 'g', toTaste: true, note: null }],
} as unknown as RecipeContent;

const add: Suggestion = { id: 'a', type: 'ingredient_add', after: { name: 'Pepe', quantity: 1, unit: 'g' }, reason: '' };

describe('applySuggestions (M9)', () => {
  it('ingredient_add e idempotente', () => {
    const r1 = applySuggestions(base, {}, [add], ['a']);
    expect(r1.content.ingredients).toHaveLength(2);
    const r2 = applySuggestions(r1.content, {}, [add], ['a']);
    expect(r2.content.ingredients).toHaveLength(2);
    expect(r2.skipped).toEqual([{ id: 'a', reason: 'duplicate' }]);
  });

  it('non duplica due add con lo stesso nome nella stessa chiamata', () => {
    const r = applySuggestions(base, {}, [add, { ...add, id: 'b' }], ['a', 'b']);
    expect(r.content.ingredients).toHaveLength(2);
  });

  it('ingredient_fix azzera quantityMax e toTaste', () => {
    const fix: Suggestion = { id: 'f', type: 'ingredient_fix', ingredientIndex: 0, before: 'Sale', after: { name: 'Sale fino', quantity: 5, unit: 'g' }, reason: '' };
    const r = applySuggestions(base, {}, [fix], ['f']);
    expect(r.content.ingredients[0]).toMatchObject({ name: 'Sale fino', quantity: 5, quantityMax: null, toTaste: false });
  });

  it('ingredient_add marca ai_estimate', () => {
    const r = applySuggestions(base, {}, [add], ['a']);
    expect(r.content.ingredients[1].flags).toEqual(['ai_estimate']);
  });

  it('ingredient_fix marca ai_estimate, toglie missing/low_confidence e conserva gli altri flag', () => {
    const src = {
      ...base,
      ingredients: [{ name: 'Sale', quantity: null, unit: null, flags: ['missing', 'low_confidence', 'ambiguous'] }],
    } as unknown as RecipeContent;
    const fix: Suggestion = { id: 'f', type: 'ingredient_fix', ingredientIndex: 0, before: 'Sale', after: { name: 'Sale', quantity: 5, unit: 'g' }, reason: '' };
    const r = applySuggestions(src, {}, [fix], ['f']);
    expect(r.content.ingredients[0].flags).toEqual(['ambiguous', 'ai_estimate']);
  });
});
