import { describe, expect, it } from 'vitest';
import { extractNumbers, guardTranslatedNumbers, sameNumbers } from '@/lib/recipes/translation';

describe('sameNumbers', () => {
  it('accepts formatting differences', () => {
    expect(sameNumbers('Cuoci a 180°C', 'Cook at 180 °C')).toBe(true);
    expect(sameNumbers('1,5 litri', '1.5 liters')).toBe(true);
    expect(sameNumbers('½ ora', '1/2 hour')).toBe(true);
    expect(sameNumbers('10-12 minuti', '10-12 minutes')).toBe(true);
    expect(sameNumbers('10-12 minuti', '10 to 12 minutes')).toBe(true);
    expect(sameNumbers('prima 5 poi 10 minuti', '10 minutes then 5')).toBe(true);
  });
  it('rejects altered or missing numbers', () => {
    expect(sameNumbers('Cuoci a 180°C', 'Cook at 350 °C')).toBe(false);
    expect(sameNumbers('10-12 minuti', '10 minutes')).toBe(false);
    expect(sameNumbers('Mescola', 'Mix for 5 minutes')).toBe(false);
  });
  it('extracts nothing from text without digits', () => {
    expect(extractNumbers('niente')).toEqual([]);
  });
});

describe('guardTranslatedNumbers', () => {
  const original = {
    title: 'Torta 24 cm',
    description: '',
    ingredients: [{ name: 'burro', note: 'a 20 °C', quantity: 100, unit: 'g' }],
    steps: [{ text: 'Cuoci 30 minuti a 180°C' }, { text: 'Lascia raffreddare' }],
  } as never;
  it('falls back to the original text only where numbers differ', () => {
    const out = guardTranslatedNumbers(original, {
      title: 'Cake 24 cm',
      description: '',
      ingredients: [{ name: 'butter', note: 'at 25 °C' }],
      steps: [{ text: 'Bake 30 minutes at 350 °C' }, { text: 'Let cool' }],
    });
    expect(out.title).toBe('Cake 24 cm');
    expect(out.ingredients[0].note).toBe('a 20 °C');
    expect(out.steps[0].text).toBe('Cuoci 30 minuti a 180°C');
    expect(out.steps[1].text).toBe('Let cool');
  });
});

describe('guardTranslatedNumbers su name e section', () => {
  const original = {
    title: 'Ricetta',
    description: '',
    ingredients: [{ name: 'uova da 60 g', note: null, section: 'Impasto 1', quantity: 2, unit: null }],
    steps: [],
  } as never;
  it('mantiene il testo originale se il modello cambia un numero', () => {
    const out = guardTranslatedNumbers(original, {
      title: 'Recipe',
      description: '',
      ingredients: [{ name: 'eggs of 600 g', note: null, section: 'Dough 2' }],
      steps: [],
    });
    expect(out.ingredients[0].name).toBe('uova da 60 g');
    expect(out.ingredients[0].section).toBe('Impasto 1');
  });
  it('accetta la traduzione con numeri uguali', () => {
    const out = guardTranslatedNumbers(original, {
      title: 'Recipe',
      description: '',
      ingredients: [{ name: 'eggs of 60 g', note: null, section: 'Dough 1' }],
      steps: [],
    });
    expect(out.ingredients[0].name).toBe('eggs of 60 g');
  });
});
