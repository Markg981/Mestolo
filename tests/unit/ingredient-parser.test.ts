import { describe, expect, it } from 'vitest';
import { parseIngredientLine, parseNumber, formatQuantity } from '@/lib/recipes/ingredient-parser';
import { normalizeUnit } from '@/lib/recipes/units';

describe('parseNumber', () => {
  it.each([
    ['1', 1], ['1,5', 1.5], ['1.5', 1.5], ['1/2', 0.5], ['1 1/2', 1.5], ['½', 0.5], ['1½', 1.5], ['1.000', 1000], ['2,000', 2000],
  ])('%s → %s', (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected as number);
  });
  it('rejects division by zero', () => expect(parseNumber('1/0')).toBeNull());
});

describe('parseIngredientLine', () => {
  it('parses simple fractions on whole lines', () => {
    expect(parseIngredientLine('1/2 cipolla')).toMatchObject({ quantity: 0.5, name: 'cipolla' });
    expect(parseIngredientLine('3/4 tsp salt')).toMatchObject({ quantity: 0.75, unit: 'tsp', name: 'salt' });
    expect(parseIngredientLine('1/4 l latte')).toMatchObject({ quantity: 0.25, unit: 'l', name: 'latte' });
  });
  it('keeps mixed numbers and unicode fractions', () => {
    expect(parseIngredientLine('1 1/2 tazze farina')).toMatchObject({ quantity: 1.5 });
    expect(parseIngredientLine('½ cipolla')).toMatchObject({ quantity: 0.5, name: 'cipolla' });
  });
  it('parses italian quantity + unit + connector + note', () => {
    expect(parseIngredientLine('200 g di farina 00 (setacciata)')).toMatchObject({
      quantity: 200, unit: 'g', name: 'farina 00', note: 'setacciata',
    });
  });
  it('parses glued units', () => {
    expect(parseIngredientLine('500g pomodori pelati')).toMatchObject({ quantity: 500, unit: 'g', name: 'pomodori pelati' });
  });
  it('parses multi-word units in several languages', () => {
    expect(parseIngredientLine('2 cucchiai di olio extravergine')).toMatchObject({ quantity: 2, unit: 'tbsp', name: 'olio extravergine' });
    expect(parseIngredientLine('1 cuillère à café de sel')).toMatchObject({ quantity: 1, unit: 'tsp', name: 'sel' });
    expect(parseIngredientLine('2 EL Zucker')).toMatchObject({ quantity: 2, unit: 'tbsp', name: 'Zucker' });
    expect(parseIngredientLine('1 ½ cups flour')).toMatchObject({ quantity: 1.5, unit: 'cup', name: 'flour' });
    expect(parseIngredientLine('3 colheres de sopa de açúcar')).toMatchObject({ quantity: 3, unit: 'tbsp', name: 'açúcar' });
  });
  it('parses ranges', () => {
    expect(parseIngredientLine("1-2 spicchi d'aglio")).toMatchObject({ quantity: 1, quantityMax: 2, unit: 'clove', name: 'aglio' });
  });
  it('parses count-only ingredients without inventing a unit', () => {
    expect(parseIngredientLine('3 uova')).toMatchObject({ quantity: 3, unit: null, name: 'uova' });
  });
  it('detects "to taste" and does not flag it as missing', () => {
    const r = parseIngredientLine('Sale q.b.');
    expect(r).toMatchObject({ name: 'Sale', quantity: null, toTaste: true });
    expect(r.flags).toBeUndefined();
    expect(parseIngredientLine('pepe nero a piacere')).toMatchObject({ name: 'pepe nero', toTaste: true });
    expect(parseIngredientLine('salt to taste')).toMatchObject({ name: 'salt', toTaste: true });
  });
  it('flags missing quantities instead of inventing them', () => {
    const r = parseIngredientLine('basilico fresco');
    expect(r.quantity).toBeNull();
    expect(r.flags).toEqual(['missing']);
  });
  it('parses trailing quantities with a known unit', () => {
    expect(parseIngredientLine('Farina 00 200 g')).toMatchObject({ name: 'Farina 00', quantity: 200, unit: 'g' });
    expect(parseIngredientLine('Burro: 50 gr')).toMatchObject({ name: 'Burro', quantity: 50, unit: 'g' });
  });
  it('does not mistake product codes for quantities', () => {
    const r = parseIngredientLine('farina tipo 1');
    expect(r.quantity).toBeNull();
    expect(r.name).toBe('farina tipo 1');
  });
  it('strips bullets and keeps the raw text', () => {
    const r = parseIngredientLine('• 100 ml latte intero, tiepido');
    expect(r).toMatchObject({ quantity: 100, unit: 'ml', name: 'latte intero', note: 'tiepido', raw: '• 100 ml latte intero, tiepido' });
  });
});

describe('units', () => {
  it('normalizes aliases, never converts', () => {
    expect(normalizeUnit('Grammi')).toBe('g');
    expect(normalizeUnit('cucchiaino')).toBe('tsp');
    expect(normalizeUnit('xícaras')).toBe('cup');
    expect(normalizeUnit('qualcosa')).toBeNull();
  });
  it('formats quantities by locale', () => {
    expect(formatQuantity(1.5, 'it')).toBe('1,5');
    expect(formatQuantity(1.5, 'en')).toBe('1.5');
    expect(formatQuantity(1, 'it', 2)).toBe('1–2');
    expect(formatQuantity(null)).toBe('');
  });
});
