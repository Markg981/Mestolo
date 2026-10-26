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
    const msgs = d.warnings.filter((w) => w.code === 'partial_content').map((w) => w.message);
    expect(msgs).toEqual(['2 invalid ingredient(s) dropped', '1 invalid step(s) dropped']);
    expect(d.warnings.some((w) => w.code === 'no_ingredients')).toBe(false);
  });
});
