import { describe, expect, it } from 'vitest';
import { convertIngredient, MAX_CONVERSION_ERROR, convertTemperatures, findDensity, formatFractionQuantity } from '@/lib/recipes/convert';
import { scaleIngredients } from '@/lib/recipes/scale';
import type { Ingredient } from '@/lib/recipes/types';
import { parseIngredientLine } from '@/lib/recipes/ingredient-parser';
import { UNIT_DIMENSION, normalizeUnit } from '@/lib/recipes/units';

const ing = (name: string, quantity: number | null, unit: string | null, extra: Partial<Ingredient> = {}): Ingredient => ({ name, quantity, unit, ...extra });
const us = (i: Ingredient) => convertIngredient(i, 'us');
const metric = (i: Ingredient) => convertIngredient(i, 'metric');

describe('convertIngredient', () => {
  it('original leaves everything untouched', () => {
    const i = ing('farina', 200, 'g');
    expect(convertIngredient(i, 'original')).toEqual({ ingredient: i, converted: false });
  });
  it('skips to-taste, missing quantity, missing or unknown units', () => {
    expect(us(ing('sale', null, null, { toTaste: true })).converted).toBe(false);
    expect(us(ing('pepe', null, 'g')).converted).toBe(false);
    expect(us(ing('uova', 2, null)).converted).toBe(false);
    expect(us(ing('aglio', 2, 'clove')).converted).toBe(false);
    expect(metric(ing('x', 1, 'bunch')).converted).toBe(false);
  });
  it('mass to US without density uses oz/lb', () => {
    expect(us(ing('pollo', 500, 'g')).ingredient).toMatchObject({ quantity: 1, unit: 'lb' });
    expect(us(ing('pollo', 100, 'g')).ingredient).toMatchObject({ quantity: 3.5, unit: 'oz' });
    expect(us(ing('pollo', 30, 'g')).ingredient).toMatchObject({ quantity: 1, unit: 'oz' });
    expect(us(ing('pollo', 1, 'kg')).ingredient).toMatchObject({ quantity: 2.25, unit: 'lb' });
  });
  it('volume to US', () => {
    expect(us(ing('brodo', 5, 'ml')).ingredient).toMatchObject({ quantity: 1, unit: 'tsp' });
    expect(us(ing('brodo', 30, 'ml')).ingredient).toMatchObject({ quantity: 2, unit: 'tbsp' });
    expect(us(ing('brodo', 250, 'ml')).ingredient).toMatchObject({ quantity: 1, unit: 'cup' });
    expect(us(ing('brodo', 1, 'l')).ingredient).toMatchObject({ unit: 'cup', quantity: 4.25 });
    expect(us(ing('brodo', 80, 'ml')).ingredient.quantity).toBeCloseTo(1 / 3, 5);
  });
  it('US to metric with 5 g / 5 ml steps', () => {
    expect(metric(ing('chicken', 1, 'lb')).ingredient).toMatchObject({ quantity: 455, unit: 'g' });
    expect(metric(ing('chicken', 4, 'oz')).ingredient).toMatchObject({ quantity: 115, unit: 'g' });
    expect(metric(ing('chicken', 3, 'lb')).ingredient).toMatchObject({ quantity: 1.35, unit: 'kg' });
    expect(metric(ing('stock', 1, 'cup')).ingredient).toMatchObject({ quantity: 235, unit: 'ml' });
    expect(metric(ing('stock', 1, 'tsp')).ingredient).toMatchObject({ quantity: 5, unit: 'ml' });
    expect(metric(ing('stock', 0.25, 'tsp')).ingredient).toMatchObject({ quantity: 1, unit: 'ml' });
    expect(metric(ing('stock', 5, 'cup')).ingredient).toMatchObject({ quantity: 1.2, unit: 'l' });
  });
  it('already-target units are not converted', () => {
    expect(metric(ing('farina', 200, 'g')).converted).toBe(false);
    expect(metric(ing('latte', 1, 'l')).converted).toBe(false);
    expect(us(ing('flour', 1, 'cup')).converted).toBe(false);
    expect(us(ing('beef', 8, 'oz')).converted).toBe(false);
  });
  it('crosses weight and volume only with a known density', () => {
    expect(us(ing('farina 00', 250, 'g')).ingredient).toMatchObject({ unit: 'cup', quantity: 2 });
    expect(us(ing('latte', 240, 'g')).ingredient).toMatchObject({ unit: 'cup', quantity: 1 });
    expect(metric(ing('flour', 1, 'cup')).ingredient).toMatchObject({ unit: 'g', quantity: 120 });
    expect(metric(ing('sugar', 1, 'tbsp')).ingredient).toMatchObject({ unit: 'g', quantity: 15 });
    expect(metric(ing('milk', 1, 'cup')).ingredient).toMatchObject({ unit: 'ml', quantity: 235 });
    expect(us(ing('spinaci', 200, 'g')).ingredient.unit).toBe('oz');
  });
  it('density name matching is conservative', () => {
    expect(findDensity('Farina 00')).not.toBeNull();
    expect(findDensity('olio di semi')).not.toBeNull();
    expect(findDensity('farina di mandorle')).toBeNull();
    expect(findDensity('latte di cocco')).toBeNull();
    expect(findDensity('zucchero a velo')).toBeNull();
    expect(findDensity('peanut butter')).toBeNull();
    expect(findDensity('')).toBeNull();
  });
  it('converts ranges and refuses mismatched units', () => {
    expect(us(ing('brodo', 100, 'ml', { quantityMax: 120 })).ingredient).toMatchObject({ unit: 'cup', quantityMax: 0.5 });
    expect(us(ing('pollo', 100, 'g', { quantityMax: 600 })).converted).toBe(false);
  });
  it('does not mutate the input and composes with servings scaling', () => {
    const i = ing('farina', 250, 'g');
    const scaled = scaleIngredients([i], 4, 8);
    const out = convertIngredient(scaled[0], 'us');
    expect(out.ingredient).toMatchObject({ unit: 'cup', quantity: 4.25 });
    expect(i).toEqual({ name: 'farina', quantity: 250, unit: 'g' });
  });
});

describe('formatFractionQuantity', () => {
  it('uses kitchen fractions', () => {
    expect(formatFractionQuantity(1)).toBe('1');
    expect(formatFractionQuantity(0.5)).toBe('½');
    expect(formatFractionQuantity(1.25)).toBe('1 ¼');
    expect(formatFractionQuantity(0.333)).toBe('⅓');
    expect(formatFractionQuantity(2.667)).toBe('2 ⅔');
    expect(formatFractionQuantity(0.125)).toBe('⅛');
  });
});

describe('convertTemperatures', () => {
  it('converts C to F for US and F to C for metric', () => {
    expect(convertTemperatures('Cuoci a 180°C per 20 min', 'us')).toBe('Cuoci a 350 °F per 20 min');
    expect(convertTemperatures('Bake at 200 °C', 'us')).toBe('Bake at 400 °F');
    expect(convertTemperatures('Bake at 350°F', 'metric')).toBe('Bake at 175 °C');
    expect(convertTemperatures('Bake at 350°F', 'us')).toBe('Bake at 350°F');
    expect(convertTemperatures('a 180 °C', 'original')).toBe('a 180 °C');
    expect(convertTemperatures('acqua a 60,5°C', 'us')).toBe('acqua a 140 °F');
    expect(convertTemperatures('nessuna temperatura', 'us')).toBe('nessuna temperatura');
  });
  it('converte entrambi gli estremi di un intervallo', () => {
    expect(convertTemperatures('Bake at 350-375°F', 'metric')).toBe('Bake at 175-190 °C');
    expect(convertTemperatures('Cuoci a 180–200 °C', 'us')).toBe('Cuoci a 350–400 °F');
    expect(convertTemperatures('Bake 350 to 375 °F', 'metric')).toBe('Bake 175 to 190 °C');
    expect(convertTemperatures('Cuoci a 180 a 200°C', 'us')).toBe('Cuoci a 350 a 400 °F');
    expect(convertTemperatures('Bake 350-375°F', 'us')).toBe('Bake 350-375°F');
  });
});

describe('once fluide (fl oz) vs once massa (oz)', () => {
  it.each(['fl oz', 'fl. oz.', 'FL OZ', 'fl.oz', 'floz', 'fluid ounce', 'fluid ounces', 'fluid oz', 'oncia liquida', 'once liquide', 'onza líquida', 'onça líquida'])(
    '"%s" è un volume (fl_oz)',
    (alias) => expect(normalizeUnit(alias)).toBe('fl_oz'),
  );
  it.each(['oz', 'ounce', 'ounces', 'oncia', 'onza', 'unze'])('"%s" resta una massa (oz)', (alias) => expect(normalizeUnit(alias)).toBe('oz'));
  it('il parser sceglie fl oz prima di oz semplice', () => {
    expect(parseIngredientLine('8 fl oz milk')).toMatchObject({ quantity: 8, unit: 'fl_oz', name: 'milk' });
    expect(parseIngredientLine('8 fl.oz milk')).toMatchObject({ unit: 'fl_oz', name: 'milk' });
    expect(parseIngredientLine('8 fluid ounces milk')).toMatchObject({ unit: 'fl_oz', name: 'milk' });
    expect(parseIngredientLine('8 oz flour')).toMatchObject({ unit: 'oz', name: 'flour' });
  });
  it('fl oz è volume, oz è massa', () => {
    expect(UNIT_DIMENSION.fl_oz).toBe('volume');
    expect(UNIT_DIMENSION.oz).toBe('mass');
  });
  it('fl oz converte in ml, oz in g', () => {
    expect(metric(ing('milk', 8, 'fl_oz')).ingredient).toMatchObject({ quantity: 235, unit: 'ml' });
    expect(metric(ing('flour', 4, 'oz')).ingredient).toMatchObject({ quantity: 115, unit: 'g' });
  });
});

describe('L-13 precisione e densita', () => {
  it('formatFractionQuantity copre tutte le frazioni unicode', () => {
    const m: Record<string, number> = { '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1 };
    for (const [g, v] of Object.entries(m)) expect(formatFractionQuantity(v)).toBe(g);
  });
  it('findDensity riconosce nomi multi-parola', () => {
    expect(findDensity('olio di oliva')).not.toBeNull();
    expect(findDensity('olive oil')).not.toBeNull();
    expect(findDensity('zucchero a velo')).toBeNull();
    expect(findDensity('zucchero')).not.toBeNull();
  });
  it('piccole quantita metriche mantengono precisione', () => {
    expect(metric(ing('acqua', 1.5, 'tsp')).ingredient.quantity).toBe(7.5);
  });
});

describe('G-07: errore di arrotondamento g -> oz', () => {
  const cases: Array<[number, string]> = [[4, 'g'], [10, 'g'], [100, 'g'], [1000, 'g'], [200, 'g']];
  it.each(cases)('%s %s: errore relativo entro il 6% oppure unita originale', (q, u) => {
    const r = convertIngredient(ing('spezia', q, u), 'us');
    if (!r.converted) {
      expect(r.ingredient.unit).toBe(u);
      return;
    }
    const factor = { oz: 28.34952, lb: 453.59237 }[r.ingredient.unit as 'oz' | 'lb'];
    expect(Math.abs((r.ingredient.quantity as number) * factor - q) / q).toBeLessThanOrEqual(MAX_CONVERSION_ERROR);
  });
  it('4 g non diventa 0,25 oz', () => {
    expect(convertIngredient(ing('zafferano', 4, 'g'), 'us')).toMatchObject({ converted: false });
  });
  it('100 g si converte, ml e cup restano invariati', () => {
    expect(convertIngredient(ing('pollo', 100, 'g'), 'us').ingredient).toMatchObject({ unit: 'oz', quantity: 3.5 });
    expect(convertIngredient(ing('brodo', 240, 'ml'), 'us').ingredient).toMatchObject({ unit: 'cup' });
    expect(convertIngredient(ing('brodo', 1, 'cup'), 'us').converted).toBe(false);
  });
});
