import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
let failTable: string | null = null;

const result = (table: string) => ({
  data: [],
  error: failTable === table ? { code: 'XX000', message: 'secret@example.com' } : null,
});
const builder = (table: string) => {
  const b: Record<string, unknown> = {
    eq: () => b,
    in: () => b,
    then: (res: (v: unknown) => unknown) => Promise.resolve(result(table)).then(res),
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

import { GET } from '@/app/api/account/export/route';

describe('GET /api/account/export', () => {
  beforeEach(() => {
    failTable = null;
    getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', created_at: 'x' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 200 with the export when every query succeeds', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).format).toBe('mestolo.account-export/v1');
  });

  it.each(['recipes', 'cook_logs', 'my_profile'])('returns 500 (no partial export) when %s fails', async (t) => {
    failTable = t;
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret@example.com');
  });
});
