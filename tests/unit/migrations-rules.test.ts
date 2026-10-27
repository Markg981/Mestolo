import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo .mjs senza tipi
import { computeCeiling, validateMigrations } from '../../scripts/lib/migrations-rules.mjs';

const now = new Date('2026-10-27T12:00:00Z');
const base = ['20261120000001_a.sql', '20261121000007_b.sql'];

describe('migrations-rules', () => {
  it('tetto = max(oggi+1g, ultima su base+1g)', () => {
    expect(computeCeiling('20261121000007', now)).toBe('20261122000007');
    expect(computeCeiling('20260101000000', now)).toBe('20261028120000');
  });
  it('accetta le migrazioni parallele note', () => {
    const cur = [...base, '20261121000008_x.sql', '20261121000101_y.sql', '20261121000111_z.sql'];
    expect(validateMigrations({ current: cur, baseFiles: base, now })).toEqual([]);
  });
  it('rifiuta timestamp oltre il tetto o non maggiore del massimo', () => {
    expect(validateMigrations({ current: [...base, '20270101000000_x.sql'], baseFiles: base, now })).toHaveLength(1);
    expect(validateMigrations({ current: [...base, '20261121000006_x.sql'], baseFiles: base, now })).toHaveLength(1);
  });
  it('rileva versioni duplicate con descrizione diversa', () => {
    const errs = validateMigrations({ current: [...base, '20261121000008_x.sql', '20261121000008_y.sql'], baseFiles: base, now });
    expect(errs.some((e: string) => e.includes('duplicata'))).toBe(true);
  });
});
