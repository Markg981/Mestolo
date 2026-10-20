import { describe, expect, it } from 'vitest';
import { AISLES, aisleFor, classifyAisle, groupByAisle, isAisle, normalizeName } from '@/lib/shopping/aisles';

const cases: Record<string, [string, string][]> = {
  it: [
    ['pomodori', 'produce'], ['mele', 'produce'], ['melanzane', 'produce'], ['petto di pollo', 'meat'], ['salsiccia', 'meat'],
    ['filetto di merluzzo', 'fish'], ['gamberi', 'fish'], ['latte intero', 'dairy'], ['mozzarella', 'dairy'], ['uova', 'dairy'],
    ['pane', 'bakery'], ['farina 00', 'pantry'], ['olio extravergine', 'pantry'], ['passata di pomodoro', 'pantry'], ['piselli surgelati', 'frozen'],
    ['gelato', 'frozen'], ['birra', 'beverages'], ['acqua frizzante', 'beverages'], ['detersivo piatti', 'household'], ['xyzzy', 'other'],
  ],
  en: [
    ['tomatoes', 'produce'], ['apple', 'produce'], ['chicken breast', 'meat'], ['salmon fillet', 'fish'], ['milk', 'dairy'], ['butter', 'dairy'],
    ['bread', 'bakery'], ['rice', 'pantry'], ['olive oil', 'pantry'], ['frozen peas', 'frozen'], ['red wine', 'beverages'], ['toilet paper', 'household'],
  ],
  es: [
    ['manzanas', 'produce'], ['cebolla', 'produce'], ['pechuga de pollo', 'meat'], ['merluza', 'fish'], ['leche', 'dairy'], ['queso', 'dairy'],
    ['arroz', 'pantry'], ['aceite de oliva', 'pantry'], ['helado', 'frozen'], ['cerveza', 'beverages'], ['papel higienico', 'household'],
  ],
  fr: [
    ['pommes', 'produce'], ['carottes', 'produce'], ['poulet', 'meat'], ['crevettes', 'fish'], ['lait', 'dairy'], ['fromage', 'dairy'],
    ['baguette', 'bakery'], ['farine', 'pantry'], ['huile', 'pantry'], ['glace', 'frozen'], ['biere', 'beverages'], ['savon', 'household'],
  ],
  de: [
    ['Äpfel', 'produce'], ['Kartoffeln', 'produce'], ['Hähnchenbrust', 'meat'], ['Lachs', 'fish'], ['Milch', 'dairy'], ['Käse', 'dairy'],
    ['Vollkornbrot', 'bakery'], ['Mehl', 'pantry'], ['Nudeln', 'pantry'], ['Tiefkühlpizza', 'frozen'], ['Wein', 'beverages'], ['Spülmittel', 'household'],
  ],
  pt: [
    ['maçã', 'produce'], ['alface', 'produce'], ['frango', 'meat'], ['bacalhau', 'fish'], ['leite', 'dairy'], ['queijo', 'dairy'],
    ['pão', 'bakery'], ['arroz', 'pantry'], ['azeite', 'pantry'], ['sorvete', 'frozen'], ['cerveja', 'beverages'], ['detergente', 'household'],
  ],
};

describe('classifyAisle', () => {
  for (const [lang, list] of Object.entries(cases)) {
    it(`classifica i prodotti in ${lang}`, () => {
      for (const [name, aisle] of list) expect(classifyAisle(name), `${lang}: ${name}`).toBe(aisle);
    });
  }

  it('e deterministico e gestisce stringhe vuote', () => {
    expect(classifyAisle('')).toBe('other');
    expect(classifyAisle('   ')).toBe('other');
    expect(classifyAisle('Pomodori')).toBe(classifyAisle('pomodori'));
  });

  it('non confonde mela con melanzana', () => {
    expect(classifyAisle('mela')).toBe('produce');
    expect(classifyAisle('melanzana')).toBe('produce');
  });
});

describe('normalizeName / isAisle', () => {
  it('toglie accenti e punteggiatura', () => {
    expect(normalizeName('  Hähnchen-Brust ')).toBe('hahnchen brust');
    expect(normalizeName('Maße')).toBe('masse');
  });
  it('riconosce i reparti validi', () => {
    expect(isAisle('dairy')).toBe(true);
    expect(isAisle('nope')).toBe(false);
  });
});

describe('groupByAisle', () => {
  const items = [
    { id: '1', name: 'latte' },
    { id: '2', name: 'mele' },
    { id: '3', name: 'xyzzy' },
    { id: '4', name: 'pane' },
    { id: '5', name: 'banane' },
  ];

  it('rispetta l ordine fisso dei reparti e omette i vuoti', () => {
    const g = groupByAisle(items);
    expect(g.map((x) => x.aisle)).toEqual(['produce', 'bakery', 'dairy', 'other']);
    expect(g[0].items.map((i) => i.id)).toEqual(['2', '5']);
    const order = g.map((x) => AISLES.indexOf(x.aisle));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('la scelta dell utente ha la precedenza', () => {
    const overrides = new Map([[normalizeName('Latte'), 'beverages' as const]]);
    expect(aisleFor('latte', overrides)).toBe('beverages');
    const g = groupByAisle(items, overrides);
    expect(g.find((x) => x.aisle === 'beverages')?.items.map((i) => i.id)).toEqual(['1']);
    expect(g.find((x) => x.aisle === 'dairy')).toBeUndefined();
  });
});
