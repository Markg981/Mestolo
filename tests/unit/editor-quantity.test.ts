import { describe, expect, it } from 'vitest';
import { emptyIngredient, emptyState, invalidQuantityIngredients, parseQuantity, toPayload } from '@/components/recipes/editor/convert';

const payloadFor = (quantity: string, unit = '') => {
  const s = emptyState('it');
  s.title = 'T';
  s.ingredients = [{ ...emptyIngredient(), name: 'farina', quantity, unit }];
  return { s, ing: toPayload(s, new Map(), { verified: true, review: false }).ingredients[0] };
};

describe('editor quantity parsing', () => {
  const cases: Array<[string, number | null, string | null, boolean]> = [
    ['1 1/2', 1.5, null, false],
    ['1½', 1.5, null, false],
    ['½', 0.5, null, false],
    ['2kg', 2, 'kg', false],
    ['1.000,5', 1000.5, null, false],
    ['1,5', 1.5, null, false],
    ['0.5', 0.5, null, false],
    ['', null, null, false],
    ['q.b.', null, null, false],
    ['abc', null, null, true],
    ['0', null, null, true],
    ['2 xyz', null, null, true],
  ];
  it.each(cases)('parseQuantity(%j)', (input, value, unit, invalid) => {
    expect(parseQuantity(input)).toMatchObject({ value, unit, invalid });
  });

  it.each([
    ['1 1/2', '', 1.5, null],
    ['1½', '', 1.5, null],
    ['1.000,5', '', 1000.5, null],
    ['2kg', '', 2, 'kg'],
    ['2kg', 'g', 2, 'g'],
    ['', '', null, null],
  ])('toPayload quantity %j unit %j', (q, u, quantity, unit) => {
    expect(payloadFor(q, u).ing).toMatchObject({ quantity, unit });
  });

  it('q.b. becomes to-taste', () => {
    expect(payloadFor('q.b.').ing).toMatchObject({ quantity: null, toTaste: true });
  });

  it('flags uninterpretable quantities so the save can be blocked', () => {
    expect(invalidQuantityIngredients(payloadFor('garbage').s)).toHaveLength(1);
    expect(invalidQuantityIngredients(payloadFor('1 1/2').s)).toHaveLength(0);
    expect(invalidQuantityIngredients(payloadFor('').s)).toHaveLength(0);
  });
});
