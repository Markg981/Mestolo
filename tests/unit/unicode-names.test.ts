import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/lib/recipes/duplicates';
import { planShoppingMerge } from '@/lib/shopping/merge';
import { aisleFor, classifyAisle, normalizeName } from '@/lib/shopping/aisles';

const item = (id: string, name: string) => ({ id, name, quantity: 1, unit: 'g', checked: false });

describe('nomi non latini', () => {
  it('non collassano a stringa vuota', () => {
    for (const n of ['米', '醤油', 'Молоко', 'γάλα', 'œuf', 'łosoś']) {
      expect(normalizeText(n)).not.toBe('');
      expect(normalizeName(n)).not.toBe('');
    }
    expect(normalizeText('œuf')).toBe('œuf');
    expect(normalizeText('łosoś')).toBe('łosos');
  });

  it('米 e 醤油 non vengono unificati, Pâté e pate si', () => {
    expect(planShoppingMerge([item('1', '米')], [item('x', '醤油')]).inserts).toHaveLength(1);
    expect(planShoppingMerge([item('1', 'Pâté')], [item('x', 'pate')]).updates).toHaveLength(1);
    expect(planShoppingMerge([item('1', '米')], [item('x', '米')]).updates).toHaveLength(1);
  });

  it('i reparti accettano override per nomi non latini', () => {
    expect(aisleFor('醤油', { [normalizeName('醤油')]: 'pantry' })).toBe('pantry');
    expect(aisleFor('Молоко', { [normalizeName('Молоко')]: 'dairy' })).toBe('dairy');
    expect(classifyAisle('米')).toBe('other');
  });

  it('i diacritici latini vengono ancora rimossi', () => {
    expect(normalizeName('Crème Fraîche')).toBe('creme fraiche');
    expect(normalizeName('Süß')).toBe('suss');
  });
});
