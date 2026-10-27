import { describe, it, expect } from 'vitest';
import { scaleIngredients } from './scale';
import type { Ingredient } from './types';

const ing = (o: Partial<Ingredient>): Ingredient => ({ name: 'x', quantity: null, unit: null, ...o }) as Ingredient;

describe('scaleIngredients', () => {
  it("collassa un intervallo con estremi uguali dopo l'arrotondamento", () => {
    const [r] = scaleIngredients([ing({ quantity: 1, quantityMax: 1.1, unit: null })], 4, 4.4);
    expect(r.quantity).toBe(1);
    expect(r.quantityMax).toBeNull();
  });
  it('mantiene un intervallo distinto', () => {
    const [r] = scaleIngredients([ing({ quantity: 100, quantityMax: 200, unit: 'g' })], 2, 4);
    expect(r.quantity).toBe(200);
    expect(r.quantityMax).toBe(400);
  });
  it('oggetti contabili: minimo mezzo pezzo, non 1', () => {
    const [r] = scaleIngredients([ing({ quantity: 1, unit: null })], 4, 1);
    expect(r.quantity).toBe(0.5);
  });
  it('contabili arrotondati a metà', () => {
    const [r] = scaleIngredients([ing({ quantity: 3, unit: null })], 4, 2);
    expect(r.quantity).toBe(1.5);
  });
  it('quantità null invariata', () => {
    expect(scaleIngredients([ing({})], 2, 4)[0].quantity).toBeNull();
  });
});
