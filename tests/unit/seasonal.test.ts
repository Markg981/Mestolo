import { describe, expect, it } from 'vitest';
import {
  SEASONAL_PRODUCTS,
  effectiveMonth,
  guessHemisphere,
  matchProduct,
  productsInSeason,
  rankSeasonalRecipes,
  seasonalIngredients,
} from '@/lib/seasonal';
import { parseMonths } from '@/lib/seasonal/data';
import { LOCALES } from '@/i18n/config';

const ids = (m: number, h: 'north' | 'south') => productsInSeason(m, h).map((p) => p.id);

describe('dataset', () => {
  it('ogni prodotto ha mesi validi e sinonimi in tutte le lingue', () => {
    for (const p of SEASONAL_PRODUCTS) {
      expect(p.months.length).toBeGreaterThan(0);
      expect(p.months.every((m) => m >= 1 && m <= 12)).toBe(true);
      for (const l of LOCALES) expect(p.names[l].length, `${p.id}/${l}`).toBeGreaterThan(0);
    }
  });
  it('parseMonths gestisce intervalli a cavallo d anno', () => {
    expect(parseMonths('11-2')).toEqual([1, 2, 11, 12]);
    expect(parseMonths('4-6,9-10')).toEqual([4, 5, 6, 9, 10]);
  });
});

describe('stagionalita', () => {
  it('emisfero nord', () => {
    expect(ids(7, 'north')).toContain('tomato');
    expect(ids(7, 'north')).not.toContain('orange');
    expect(ids(1, 'north')).toContain('orange');
  });
  it('emisfero sud sfasato di 6 mesi', () => {
    expect(effectiveMonth(1, 'south')).toBe(7);
    expect(effectiveMonth(12, 'south')).toBe(6);
    expect(ids(1, 'south')).toContain('tomato');
    expect(ids(1, 'south')).not.toContain('orange');
  });
  it('deduce l emisfero dalla lingua', () => {
    expect(guessHemisphere('pt-BR,pt;q=0.9')).toBe('south');
    expect(guessHemisphere('it-IT,it;q=0.9')).toBe('north');
    expect(guessHemisphere(null)).toBe('north');
  });
});

describe('riconoscimento ingredienti', () => {
  it('riconosce sinonimi in piu lingue, con accenti e maiuscole', () => {
    expect(matchProduct('Pomodorini ciliegino')?.id).toBe('tomato');
    expect(matchProduct('2 Äpfel')?.id).toBe('apple');
    expect(matchProduct('Zwetschgen')?.id).toBe('plum');
    expect(matchProduct('courgettes')?.id).toBe('zucchini');
    expect(matchProduct('cavolini di Bruxelles')?.id).toBe('brusselssprouts');
  });
  it('non confonde parole che ne contengono altre', () => {
    expect(matchProduct('farina')).toBeNull();
    expect(matchProduct('peperoncino')).toBeNull();
    expect(matchProduct('sale')).toBeNull();
  });
  it('conta gli ingredienti di stagione', () => {
    const ing = [{ name: 'pomodori' }, { name: 'zucchine' }, { name: 'arance' }, { name: 'sale' }];
    const s = seasonalIngredients(ing, 7, 'north');
    expect(s.seasonalCount).toBe(2);
    expect(s.total).toBe(4);
    expect(s.products.map((p) => p.id).sort()).toEqual(['tomato', 'zucchini']);
    expect(seasonalIngredients(ing, 7, 'south').products.map((p) => p.id)).toEqual(['orange']);
  });
  it('ordina le ricette per prodotti di stagione', () => {
    const a = { id: 'a', ingredients: [{ name: 'sale' }] };
    const b = { id: 'b', ingredients: [{ name: 'pomodori' }] };
    const c = { id: 'c', ingredients: [{ name: 'pomodori' }, { name: 'melanzane' }, { name: 'olio' }] };
    const r = rankSeasonalRecipes([a, b, c], 7, 'north');
    expect(r.map((x) => x.recipe.id)).toEqual(['c', 'b']);
  });
});
