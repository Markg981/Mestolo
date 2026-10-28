import { describe, expect, it } from 'vitest';
import { pantryMatchKey, type PantryItem } from '@/lib/pantry/match';
import { subtractPantry } from './planning';

const today = '2026-10-20';
const p = (name: string, quantity: number | null, unit: string | null, expires_on: string | null = null): PantryItem => ({ id: name, name, quantity, unit, expires_on, location: 'pantry', note: null });

describe('pantryMatchKey', () => {
  it('ignora maiuscole, accenti e plurali semplici', () => {
    expect(pantryMatchKey('Uova')).toBe(pantryMatchKey('uovo'));
    expect(pantryMatchKey('Pomodori')).toBe(pantryMatchKey('pomodoro'));
    expect(pantryMatchKey('Tomatoes')).toBe(pantryMatchKey('tomato'));
    expect(pantryMatchKey('Berries')).toBe(pantryMatchKey('berry'));
    expect(pantryMatchKey('Perché')).toBe(pantryMatchKey('perche'));
  });
  it('non fonde nomi diversi', () => {
    expect(pantryMatchKey('farina 00')).not.toBe(pantryMatchKey('farina integrale'));
  });
});

describe('subtractPantry', () => {
  it('sottrazione totale: la riga sparisce', () => {
    expect(subtractPantry([{ name: 'Farina', quantity: 200, unit: 'g' }], [p('farina', 500, 'g')], today)).toEqual([]);
  });
  it('sottrazione parziale con unita compatibili', () => {
    const r = subtractPantry([{ name: 'farina', quantity: 1, unit: 'kg' }], [p('Farina', 300, 'g')], today);
    expect(r).toEqual([{ name: 'farina', quantity: 0.7, unit: 'kg' }]);
  });
  it('match normalizzato singolare/plurale', () => {
    expect(subtractPantry([{ name: 'uova', quantity: 2, unit: null }], [p('uovo', 6, null)], today)).toEqual([]);
  });
  it('unita incompatibili: nessuna sottrazione', () => {
    const items = [{ name: 'latte', quantity: 500, unit: 'ml' }];
    expect(subtractPantry(items, [p('latte', 500, 'g')], today)).toEqual(items);
    expect(subtractPantry(items, [p('latte', 2, null)], today)).toEqual(items);
  });
  it('quantita ignote o scorte scadute non sottraggono', () => {
    const items = [
      { name: 'sale', quantity: 5, unit: 'g' },
      { name: 'olio', quantity: null, unit: null },
    ];
    expect(subtractPantry(items, [p('sale', null, null), p('olio', 1, 'l'), p('sale', 100, 'g', '2026-10-01')], today)).toEqual(items);
  });
  it('la scorta non viene usata due volte e l input non e mutato', () => {
    const items = [
      { name: 'riso', quantity: 300, unit: 'g' },
      { name: 'riso', quantity: 300, unit: 'g' },
    ];
    const r = subtractPantry(items, [p('riso', 400, 'g')], today);
    expect(r).toEqual([{ name: 'riso', quantity: 200, unit: 'g' }]);
    expect(items[1].quantity).toBe(300);
  });
});
