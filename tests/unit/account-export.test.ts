import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
let failTable: string | null = null;

const inLengths: number[] = [];
const orFilters: [string, string][] = [];
const ranges: [string, number][] = [];
let bigRecipes = 0;
let failVersionsPage2 = false;
const result = (table: string, from = 0) => ({
  data:
    table === 'recipes' && bigRecipes
      ? Array.from({ length: Math.max(0, Math.min(1000, bigRecipes - from)) }, (_, i) => ({ id: `r${from + i}` }))
      : [],
  error: failVersionsPage2 && table === 'recipe_versions' ? { code: 'XX' } : failTable === table ? { code: 'XX000', message: 'secret@example.com' } : null,
});
const builder = (table: string) => {
  const b: Record<string, unknown> = {
    eq: () => b,
    or: (f: string) => {
      orFilters.push([table, f]);
      return b;
    },
    in: (_c: string, ids: string[]) => {
      inLengths.push(ids.length);
      return b;
    },
    order: () => b,
    range: (from: number) => {
      ranges.push([table, from]);
      return b;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve(result(table, ranges.at(-1)?.[1] ?? 0)).then(res),
  };
  return b;
};

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (t: string) => ({ select: () => builder(t) }),
    rpc: (fn: string) => {
      const r = Promise.resolve(result(fn)) as Promise<unknown> & { maybeSingle?: () => Promise<unknown> };
      r.maybeSingle = () => Promise.resolve(result(fn));
      return r;
    },
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: async () => undefined,
  RateLimitedError: class extends Error {},
}));

import { POST } from '@/app/api/account/export/route';

describe('POST /api/account/export', () => {
  beforeEach(() => {
    failTable = null;
    bigRecipes = 0;
    failVersionsPage2 = false;
    inLengths.length = 0;
    ranges.length = 0;
    orFilters.length = 0;
    getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', created_at: 'x' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 200 with the export when every query succeeds', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).format).toBe('mestolo.account-export/v1');
  });

  it("non espone piu' GET (la quota export_data non si brucia con un link)", async () => {
    const mod = (await import('@/app/api/account/export/route')) as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
  });

  it('risponde con cache-control no-store', async () => {
    const res = await POST();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('filters friendships explicitly by user and exports maxDuration', async () => {
    const mod = await import('@/app/api/account/export/route');
    expect(mod.maxDuration).toBe(60);
    await POST();
    expect(orFilters).toEqual([['friendships', 'requester_id.eq.u1,addressee_id.eq.u1']]);
  });

  it.each(['recipes', 'cook_logs', 'my_profile'])('returns 500 (no partial export) when %s fails', async (t) => {
    failTable = t;
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret@example.com');
  });

  it('pages recipes past 1000 rows and chunks the recipe_id lists by 100', async () => {
    bigRecipes = 1050;
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).recipes).toHaveLength(1050);
    expect(ranges.filter(([t]) => t === 'recipes').map(([, f]) => f)).toEqual([0, 1000]);
    expect(Math.max(...inLengths)).toBe(100);
    expect(inLengths.filter((n) => n === 100)).toHaveLength(30); // 10 full chunks x 3 tables (+ a 50-id tail)
  });

  it('returns 500 when a chunked section fails', async () => {
    bigRecipes = 150;
    failVersionsPage2 = true;
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
