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
  // A1/A2: fractions and decimals on whole lines, with unit, connector, name and note
  it.each([
    ['1,5 kg di farina', 1.5, null, 'kg', 'farina', null],
    ['1.5 kg farina', 1.5, null, 'kg', 'farina', null],
    ['10,5 g sale', 10.5, null, 'g', 'sale', null],
    ['0,5 l di latte (tiepido)', 0.5, null, 'l', 'latte', 'tiepido'],
    ['2,25 dl panna, fredda', 2.25, null, 'dl', 'panna', 'fredda'],
    ['2.5 oz butter, softened', 2.5, null, 'oz', 'butter', 'softened'],
    ['1,000 kg farina', 1, null, 'kg', 'farina', null],
    ['1 1/2 kg di patate', 1.5, null, 'kg', 'patate', null],
    ['1 / 2 cipolla', 0.5, null, null, 'cipolla', null],
    ['1 1 / 2 kg di patate', 1.5, null, 'kg', 'patate', null],
    ['1/3 tazza di olio', 1 / 3, null, 'cup', 'olio', null],
    ['3/4 di cipolla', 0.75, null, null, 'cipolla', null],
    ['1/2 bicchiere di vino bianco', 0.5, null, 'glass', 'vino bianco', null],
    ['½ cucchiaino di lievito', 0.5, null, 'tsp', 'lievito', null],
    ['1½ cucchiaino di sale', 1.5, null, 'tsp', 'sale', null],
    ['1 ½ tazze di farina', 1.5, null, 'cup', 'farina', null],
    ['¾ cup sugar', 0.75, null, 'cup', 'sugar', null],
    ['2 ⅓ cups milk', 7 / 3, null, 'cup', 'milk', null],
    ['1,5 uova', 1.5, null, null, 'uova', null],
    ['1-1,5 kg di cozze', 1, 1.5, 'kg', 'cozze', null],
    ['1,5-2 l brodo', 1.5, 2, 'l', 'brodo', null],
    ['1/2-1 cucchiaino di peperoncino', 0.5, 1, 'tsp', 'peperoncino', null],
    ['Zucchero 1/2 cucchiaino', 0.5, null, 'tsp', 'Zucchero', null],
    ['Latte 0,5 l', 0.5, null, 'l', 'Latte', null],
    ['Burro 1 1/2 tbsp', 1.5, null, 'tbsp', 'Burro', null],
  ])('whole line %s', (line, q, qMax, unit, name, note) => {
    const r = parseIngredientLine(line as string);
    expect(r.quantity).toBeCloseTo(q as number);
    expect(r.quantityMax ?? null).toBe(qMax);
    expect(r).toMatchObject({ unit, name, note });
    expect(r.flags).toBeUndefined();
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

  describe('decimal comma vs thousands separator', () => {
    it.each([
      ['0,250 kg', 0.25, 'kg'], ['1,250 kg', 1.25, 'kg'], ['1.000 g', 1000, 'g'],
      ['1,5 l', 1.5, 'l'], ['0.500 l', 0.5, 'l'], ['0,250 g', 0.25, 'g'], ['1,250 l', 1.25, 'l'],
    ])('%s', (line, q, u) => {
      expect(parseIngredientLine(line + ' farina')).toMatchObject({ quantity: q, unit: u });
    });
    it('trailing form uses unit context', () => {
      expect(parseIngredientLine('Farina 1,250 kg')).toMatchObject({ quantity: 1.25, unit: 'kg' });
    });
    it('parseNumber: unità energetiche usano il gruppo da 3 cifre come migliaia (G-13)', () => {
      expect(parseNumber('1,250', 'kcal')).toBe(1250);
      expect(parseNumber('1.250', 'kJ'.toLowerCase())).toBe(1250);
      expect(parseNumber('1,25', 'kg')).toBeCloseTo(1.25);
      expect(parseNumber('1,250', 'kg')).toBeCloseTo(1.25);
    });
    it('parseNumber leading zero is always decimal', () => {
      expect(parseNumber('0,250')).toBeCloseTo(0.25);
    });
  });
});

describe('parseIngredientLine: moltiplicatore e numeri misti con congiunzione (L-12)', () => {
  it('"2 x 400 g" diventa la quantità totale 800 g', () => {
    expect(parseIngredientLine('2 x 400 g pelati')).toMatchObject({ quantity: 800, unit: 'g', name: 'pelati' });
    expect(parseIngredientLine('3×200 g burro')).toMatchObject({ quantity: 600, unit: 'g', name: 'burro' });
  });
  it('"1 e 1/2" vale 1.5', () => {
    expect(parseIngredientLine('1 e 1/2 cucchiai olio')).toMatchObject({ quantity: 1.5, name: 'olio' });
    expect(parseIngredientLine('1 and 1/2 cups flour')).toMatchObject({ quantity: 1.5, unit: 'cup' });
  });
});

describe('parseIngredientLine: numerali in parola, doppia notazione, zero e negativi (G-03)', () => {
  it.each([
    ['una cipolla', 1, null, 'cipolla'],
    ['un uovo', 1, null, 'uovo'],
    ['mezzo limone', 0.5, null, 'limone'],
    ['due uova', 2, null, 'uova'],
    ['tre carote', 3, null, 'carote'],
    ['one onion', 1, null, 'onion'],
    ['an egg', 1, null, 'egg'],
    ['half a lemon', 0.5, null, 'lemon'],
    ['two eggs', 2, null, 'eggs'],
    ['dos huevos', 2, null, 'huevos'],
    ['deux oeufs', 2, null, 'oeufs'],
    ['drei Eier', 3, null, 'Eier'],
    ['1 cucchiaio e mezzo di miele', 1.5, 'tbsp', 'miele'],
    ['1 tablespoon and a half honey', 1.5, 'tbsp', 'honey'],
    ['1 and a half cups flour', 1.5, 'cup', 'flour'],
    ['30g/1oz sugar', 30, 'g', 'sugar'],
    ['1 cup/240 ml milk', 1, 'cup', 'milk'],
    ['200g farina', 200, 'g', 'farina'],
  ])('%s', (line, q, u, name) => {
    expect(parseIngredientLine(line)).toMatchObject({ quantity: q, unit: u, name });
  });

  it('rifiuta i negativi', () => {
    const r = parseIngredientLine('-2 g sale');
    expect(r.quantity).toBeNull();
    expect(r.name).toBe('sale');
    expect(r.flags).toContain('missing');
  });
  it('il trattino-elenco con spazio resta un elenco', () => {
    expect(parseIngredientLine('- 2 g sale')).toMatchObject({ quantity: 2, unit: 'g', name: 'sale' });
  });
  it('zero: quantita null e nome pulito', () => {
    const r = parseIngredientLine('0 g sale');
    expect(r.quantity).toBeNull();
    expect(r.name).toBe('sale');
    expect(r.flags).toContain('missing');
  });
  it('"+ N per ..." finisce nella nota', () => {
    expect(parseIngredientLine('2 uova + 1 per spennellare')).toMatchObject({
      quantity: 2, name: 'uova', note: '+ 1 per spennellare',
    });
  });
  it('senza numerale resta invariato', () => {
    expect(parseIngredientLine('sale q.b.')).toMatchObject({ quantity: null });
    expect(parseIngredientLine('Farina 00 200 g')).toMatchObject({ quantity: 200, unit: 'g' });
  });
});
