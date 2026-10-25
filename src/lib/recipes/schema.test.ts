import { describe, expect, it } from 'vitest';
import { RECIPE_LIMITS, recipeInputSchema } from './schema';

const base = {
  title: 'Torta',
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: null,
  ingredients: [{ name: 'farina', quantity: 100, unit: 'g' }],
  steps: [{ text: 'Mescola' }],
  category_id: null,
  tags: [],
};

describe('recipeInputSchema limiti', () => {
  it('accetta i valori al limite esatto', () => {
    const r = recipeInputSchema.safeParse({
      ...base,
      title: 'a'.repeat(RECIPE_LIMITS.title),
      ingredients: [{ name: 'a'.repeat(RECIPE_LIMITS.ingredientName), quantity: 1 }],
      steps: [{ text: 'a'.repeat(RECIPE_LIMITS.stepText) }],
    });
    expect(r.success).toBe(true);
  });

  it('rifiuta nome ingrediente oltre il limite indicando il percorso', () => {
    const r = recipeInputSchema.safeParse({
      ...base,
      ingredients: [{ name: 'a'.repeat(RECIPE_LIMITS.ingredientName + 1), quantity: 1 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path.join('.')).toBe('ingredients.0.name');
  });

  it('rifiuta passo oltre il limite indicando il percorso', () => {
    const r = recipeInputSchema.safeParse({ ...base, steps: [{ text: 'a'.repeat(RECIPE_LIMITS.stepText + 1) }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path.join('.')).toBe('steps.0.text');
  });
});
