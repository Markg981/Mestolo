import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/lib/recipes/duplicates';
import { aisleFor, classifyAisle, normalizeName } from '@/lib/shopping/aisles';

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
    expect(normalizeText('米')).not.toBe(normalizeText('醤油'));
    expect(normalizeText('Pâté')).toBe(normalizeText('pate'));
    expect(normalizeText('米')).toBe(normalizeText('米'));
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
