import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaims = vi.fn();
const maybeSingle = vi.fn();
const download = vi.fn();
const fromBucket = vi.fn<(bucket: string) => { download: typeof download }>(() => ({ download }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    storage: { from: fromBucket },
  }),
}));

import { GET } from '@/app/api/cook-photos/[id]/route';
import type { NextRequest } from 'next/server';

const ID = '22222222-2222-2222-2222-222222222222';
const req = () => ({}) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

describe('GET /api/cook-photos/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fromBucket.mockImplementation(() => ({ download }));
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } } });
  });

  it('returns 404 for a malformed id before touching auth or the DB', async () => {
    expect((await GET(req(), ctx('../etc/passwd'))).status).toBe(404);
    expect((await GET(req(), ctx('short'))).status).toBe(404);
    expect(getClaims).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests without hitting the DB', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns 404 when RLS hides the log or it has no photo', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: { user_id: 'o', photo_path: null } });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it('returns 404 when the path is outside the author cook folder', async () => {
    for (const photo_path of ['other/cook/a.webp', 'o/recipes/a.webp', 'o/a.webp']) {
      maybeSingle.mockResolvedValue({ data: { user_id: 'o', photo_path } });
      expect((await GET(req(), ctx())).status).toBe(404);
    }
    expect(download).not.toHaveBeenCalled();
  });

  it('returns 404 when the storage download fails', async () => {
    maybeSingle.mockResolvedValue({ data: { user_id: 'o', photo_path: 'o/cook/a.webp' } });
    download.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it('serves the file from recipe-images with revalidating private cache and hardening headers', async () => {
    maybeSingle.mockResolvedValue({ data: { user_id: 'o', photo_path: 'o/cook/a.webp' } });
    download.mockResolvedValue({ data: new Blob(['x']), error: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(fromBucket).toHaveBeenCalledWith('recipe-images');
    expect(download).toHaveBeenCalledWith('o/cook/a.webp');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(await res.text()).toBe('x');
  });
});
