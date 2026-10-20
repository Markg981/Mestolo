import { describe, expect, it } from 'vitest';
import { daysUntil, expiryStatus, sortByExpiry, suggestRecipes, type PantryItem } from './match';

const today = '2026-10-20';
const item = (name: string, expires_on: string | null = null): PantryItem => ({ id: name, name, quantity: null, unit: null, expires_on, location: 'pantry', note: null });

describe('expiry', () => {
  it('computes days and status', () => {
    expect(daysUntil('2026-10-23', today)).toBe(3);
    expect(daysUntil('2026-10-19', today)).toBe(-1);
    expect(daysUntil(null, today)).toBeNull();
    expect(expiryStatus('2026-10-19', today)).toBe('expired');
    expect(expiryStatus('2026-10-20', today)).toBe('soon');
    expect(expiryStatus('2026-10-23', today)).toBe('soon');
    expect(expiryStatus('2026-10-24', today)).toBe('ok');
    expect(expiryStatus(null, today)).toBe('none');
  });
  it('sorts by expiry with undated last', () => {
    const s = sortByExpiry([item('c'), item('b', '2026-11-01'), item('a', '2026-10-25')]);
    expect(s.map((i) => i.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('suggestRecipes', () => {
  const pasta = { id: 'r1', title: 'Pasta', ingredients: [{ name: 'Spaghetti' }, { name: 'Pomodoro' }, { name: 'Sale', toTaste: true }] };
  const frittata = { id: 'r2', title: 'Frittata', ingredients: [{ name: 'Uova' }, { name: 'Zucchine' }, { name: 'Formaggio' }] };
  const dolce = { id: 'r3', title: 'Dolce', ingredients: [{ name: 'Zucchero' }] };

  it('ranks by coverage and lists what is missing', () => {
    const r = suggestRecipes([frittata, pasta, dolce], [item('spaghetti'), item('POMODORO')], today);
    expect(r.map((x) => x.recipeId)).toEqual(['r1']);
    expect(r[0].missingIndexes).toEqual([]);
    expect(r[0].coverage).toBe(1);
  });
  it('matches accents and case, lists missing indexes', () => {
    const r = suggestRecipes([frittata], [item('uova')], today);
    expect(r[0].missingIndexes).toEqual([1, 2]);
    expect(r[0].missingNames).toEqual(['Zucchine', 'Formaggio']);
  });
  it('prioritises recipes that use expiring items', () => {
    const r = suggestRecipes([pasta, frittata], [item('spaghetti'), item('pomodoro'), item('zucchine', '2026-10-21')], today);
    expect(r[0].recipeId).toBe('r2');
    expect(r[0].expiringUsed).toEqual(['zucchine']);
  });
  it('ignores expired items and excludes recipes with no match', () => {
    const r = suggestRecipes([frittata, dolce], [item('uova', '2026-10-01')], today);
    expect(r).toEqual([]);
  });
});
