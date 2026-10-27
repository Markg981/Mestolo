import { describe, expect, it } from 'vitest';
import { convertIngredient, convertTemperatures, findDensity, formatFractionQuantity } from '@/lib/recipes/convert';
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
