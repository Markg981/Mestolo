import { describe, expect, it } from 'vitest';
import { parseHumanDuration, parseIsoDuration } from '@/lib/recipes/duration';
import { parseRecipeText } from '@/lib/recipes/text-parser';

describe('durations', () => {
  it.each([
    ['PT1H30M', 90], ['PT45M', 45], ['P1DT2H', 1560], ['PT0M', null], ['garbage', null], ['PT', null],
  ])('iso %s', (v, expected) => expect(parseIsoDuration(v)).toBe(expected));

  it.each([
    ['45 min', 45], ['1 ora e 30 minuti', 90], ['1h20', 80], ['1 hour 15 minutes', 75], ['1,5 ore', 90], ['2 Stunden', 120], ['nessuna', null],
  ])('human %s', (v, expected) => expect(parseHumanDuration(v)).toBe(expected));
});

describe('parseRecipeText', () => {
  it('parses a pasted Italian recipe with headers', () => {
    const r = parseRecipeText(`Pasta al pomodoro
Un classico veloce.
Per 4 persone
Preparazione: 10 min
Cottura: 15 minuti

Ingredienti
320 g spaghetti
400 g pomodori pelati
2 cucchiai olio extravergine
Sale q.b.

Procedimento
1. Scaldare l'olio in padella.
2. Aggiungere i pomodori e cuocere
per 10 minuti.
3. Scolare la pasta e condire.`);
    expect(r.title).toBe('Pasta al pomodoro');
    expect(r.description).toBe('Un classico veloce.');
    expect(r.servings).toBe(4);
    expect(r.prep_minutes).toBe(10);
    expect(r.cook_minutes).toBe(15);
    expect(r.ingredients).toHaveLength(4);
    expect(r.ingredients[0]).toMatchObject({ quantity: 320, unit: 'g', name: 'spaghetti' });
    expect(r.steps.map((s) => s.text)).toEqual([
      "Scaldare l'olio in padella.",
      'Aggiungere i pomodori e cuocere per 10 minuti.',
      'Scolare la pasta e condire.',
    ]);
    expect(r.field_flags.servings).toBeUndefined();
    expect(r.total_minutes).toBeNull(); // never computed/invented
  });

  it('flags missing fields and does not invent them', () => {
    const r = parseRecipeText('Torta misteriosa\nMescolare tutto e infornare.');
    expect(r.servings).toBeNull();
    expect(r.field_flags.servings).toEqual(['missing']);
    expect(r.field_flags.ingredients).toEqual(['missing']);
    expect(r.warnings.map((w) => w.code)).toContain('no_ingredients');
  });

  it('works without headers by detecting ingredient-like lines', () => {
    const r = parseRecipeText(`Pancakes
200 g flour
2 eggs
300 ml milk
Whisk everything together.
Cook in a hot pan.`);
    expect(r.ingredients.map((i) => i.name)).toEqual(['flour', 'eggs', 'milk']);
    expect(r.steps).toHaveLength(2);
    expect(r.warnings.map((w) => w.code)).toContain('low_confidence');
  });

  it('recognises headers in other languages', () => {
    const r = parseRecipeText(`Crêpes\nIngrédients\n250 g de farine\n3 oeufs\nPréparation\nMélanger la farine et les oeufs.`);
    expect(r.ingredients).toHaveLength(2);
    expect(r.steps).toHaveLength(1);
  });
});
