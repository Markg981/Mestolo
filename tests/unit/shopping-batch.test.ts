import { describe, expect, it } from 'vitest';
import { chunkIdempotencyKey, chunkShoppingItems, collapseShoppingItems } from '@/lib/shopping/batch';

const mk = (n: number, name = (i: number) => `ing${i}`) =>
  Array.from({ length: n }, (_, i) => ({ name: name(i), quantity: 1, unit: 'g' as string | null }));

describe('collapseShoppingItems', () => {
  it('250 item con duplicati collassano sotto 200 (una sola chiamata)', () => {
    const out = collapseShoppingItems(mk(250, (i) => `ing${i % 100}`));
    expect(out).toHaveLength(100);
    expect(out[0].quantity).toBe(3);
    expect(chunkShoppingItems(out)).toHaveLength(1);
  });
  it('non fonde unita o presenza di quantita diverse', () => {
    const out = collapseShoppingItems([
      { name: 'Sale', quantity: null, unit: null },
      { name: 'sale', quantity: null, unit: null },
      { name: 'sale', quantity: 2, unit: 'g' },
      { name: 'sale', quantity: 2, unit: 'kg' },
    ]);
    expect(out).toHaveLength(3);
  });
});

describe('chunkShoppingItems', () => {
  it('250 unici in due chiamate da 200 + 50', () => {
    const chunks = chunkShoppingItems(collapseShoppingItems(mk(250)));
    expect(chunks.map((c) => c.length)).toEqual([200, 50]);
  });
});

describe('chunkIdempotencyKey', () => {
  const base = '6f1c1e0e-1b7a-4d55-9a53-0a1b2c3d4e5f';
  it('blocco 0 usa la chiave base, gli altri UUID deterministici e distinti', () => {
    expect(chunkIdempotencyKey(base, 0)).toBe(base);
    const k1 = chunkIdempotencyKey(base, 1);
    expect(k1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(chunkIdempotencyKey(base, 1)).toBe(k1);
    expect(chunkIdempotencyKey(base, 2)).not.toBe(k1);
  });
});
