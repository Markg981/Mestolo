import { describe, expect, it } from 'vitest';
import { importIdentity } from '@/lib/recipes/import-identity';

describe('importIdentity (M13)', () => {
  it('e stabile per lo stesso contenuto', () => {
    expect(importIdentity({ title: 'Carbonara' })).toBe(importIdentity({ title: 'Carbonara' }));
  });
  it('cambia per un import diverso, quindi cambia la chiave della bozza', () => {
    expect(importIdentity({ title: 'Carbonara' })).not.toBe(importIdentity({ title: 'Amatriciana' }));
  });
});
