import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remove = vi.fn(async () => ({ error: null as { message: string } | null }));
const from = vi.fn((bucket: string) => ({ remove, bucket }));
const rpc = vi.fn(async (fn: string) =>
  fn === 'list_orphan_images'
    ? { data: [{ name: 'u/a.webp' }, { name: 'u/a_t.webp' }], error: null }
    : fn === 'list_orphan_avatars'
      ? { data: [{ name: 'u/old.webp' }], error: null }
      : { data: { ai_usage: 1 }, error: null },
);
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc, storage: { from } }),
}));

import { GET } from '@/app/api/cron/cleanup/route';

const req = (auth?: string) => new Request('http://localhost/api/cron/cleanup', { headers: auth ? { authorization: auth } : {} });

describe('GET /api/cron/cleanup', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'topsecret');
    rpc.mockClear();
    remove.mockClear();
    from.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects missing or wrong credentials without touching the database', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects everything when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(req('Bearer '))).status).toBe(401);
    expect((await GET(req('Bearer undefined'))).status).toBe(401);
  });

  it('removes orphan files through the Storage API', async () => {
    const res = await GET(req('Bearer topsecret'));
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('recipe-images');
    expect(remove).toHaveBeenCalledWith(['u/a.webp', 'u/a_t.webp']);
    expect(from).toHaveBeenCalledWith('avatars');
    expect(remove).toHaveBeenCalledWith(['u/old.webp']);
    expect(await res.json()).toMatchObject({ ok: true, orphansRemoved: 3 });
  });

  it('reports a failed avatar removal instead of ignoring it', async () => {
    remove.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } });
    const res = await GET(req('Bearer topsecret'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'remove_failed' });
  });
});
