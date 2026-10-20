import { describe, expect, it } from 'vitest';
import { applyKeyset, decodeCursor, encodeCursor, keysetFilter, toPage } from '@/lib/pagination';

const ID = '11111111-1111-1111-1111-111111111111';
const ID2 = '22222222-2222-2222-2222-222222222222';

describe('cursor', () => {
  it('fa round trip', () => {
    expect(decodeCursor(encodeCursor({ v: '2026-01-01T00:00:00+00:00', i: ID }))).toEqual({ v: '2026-01-01T00:00:00+00:00', i: ID });
    expect(decodeCursor(encodeCursor({ v: null, i: ID }))).toEqual({ v: null, i: ID });
    expect(decodeCursor(encodeCursor({ v: 15, i: ID }))).toEqual({ v: 15, i: ID });
  });
  it('scarta cursori malformati o manomessi', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    for (const bad of [undefined, null, '', 'zzz', 'e30', 'x'.repeat(500), b64('{"v":1,"i":"drop"}'), b64(`{"v":{},"i":"${ID}"}`)]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
});

describe('keysetFilter', () => {
  it('discendente su created_at', () => {
    expect(keysetFilter({ column: 'created_at', ascending: false }, { v: '2026-01-01', i: ID })).toBe(
      `created_at.lt."2026-01-01",and(created_at.eq."2026-01-01",id.lt.${ID})`,
    );
  });
  it('ascendente con colonna nullable include i NULL in coda', () => {
    expect(keysetFilter({ column: 'total_minutes', ascending: true, nullable: true }, { v: 20, i: ID })).toBe(
      `total_minutes.gt.20,and(total_minutes.eq.20,id.gt.${ID}),total_minutes.is.null`,
    );
  });
  it('dentro il gruppo NULL resta solo il confronto sull id', () => {
    expect(keysetFilter({ column: 'total_minutes', ascending: true, nullable: true }, { v: null, i: ID })).toBe(`and(total_minutes.is.null,id.gt.${ID})`);
  });
  it('esegue l escape di virgolette e backslash nei titoli', () => {
    expect(keysetFilter({ column: 'title', ascending: true }, { v: 'a"b,c\\', i: ID })).toContain('title.gt."a\\"b,c\\\\"');
  });
});

describe('toPage', () => {
  const sort = { column: 'created_at', ascending: false };
  it('ultima pagina: nessun cursore', () => {
    expect(toPage([{ id: ID, created_at: 'a' }], sort, 2)).toEqual({ items: [{ id: ID, created_at: 'a' }], nextCursor: null });
  });
  it('pagina piena: scarta la riga extra e punta all ultima servita', () => {
    const rows = [
      { id: ID, created_at: 'b' },
      { id: ID2, created_at: 'a' },
      { id: 'x', created_at: 'z' },
    ];
    const p = toPage(rows, sort, 2);
    expect(p.items).toHaveLength(2);
    expect(decodeCursor(p.nextCursor)).toEqual({ v: 'a', i: ID2 });
  });
  it('valore NULL nella colonna di ordinamento', () => {
    const p = toPage([{ id: ID, total_minutes: null }, { id: ID2, total_minutes: null }], { column: 'total_minutes', ascending: true, nullable: true }, 1);
    expect(decodeCursor(p.nextCursor)).toEqual({ v: null, i: ID });
  });
});

describe('applyKeyset', () => {
  it('ordina per colonna e id, applica il cursore e limita a pageSize+1', () => {
    const calls: string[] = [];
    const q = {
      order: (c: string, o?: object) => (calls.push(`order ${c} ${JSON.stringify(o)}`), q),
      or: (f: string) => (calls.push(`or ${f}`), q),
      limit: (n: number) => (calls.push(`limit ${n}`), q),
    };
    applyKeyset(q, { column: 'created_at', ascending: false }, { v: 'v', i: ID }, 24);
    expect(calls[0]).toMatch(/^or created_at\.lt/);
    expect(calls).toContain('limit 25');
    expect(calls.filter((c) => c.startsWith('order'))).toHaveLength(2);
  });
});
