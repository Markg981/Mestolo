import { describe, expect, it } from 'vitest';
import { draftFromExtraction } from './extraction';

describe('draftFromExtraction partial arrays', () => {
  it('keeps valid ingredients and steps and reports drops', () => {
    const d = draftFromExtraction(
      {
        title: 'Test',
        ingredients: [{ name: 'Farina', quantity: 100, unit: 'g' }, { name: 42 }, null, { name: 'Uova', quantity: 2 }],
        steps: [{ text: 'Mescola' }, { text: 5 }],
      },
      'text' as never,
    );
    expect(d.content.ingredients.map((i) => i.name)).toEqual(['Farina', 'Uova']);
    expect(d.content.steps).toHaveLength(1);
    expect(d.warnings.filter((w) => w.code === 'invalid_items_dropped')).toHaveLength(1);
    expect(d.warnings.some((w) => w.code === 'no_ingredients')).toBe(false);
  });
});
