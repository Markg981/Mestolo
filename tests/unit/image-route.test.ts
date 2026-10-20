import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaims = vi.fn();
const maybeSingle = vi.fn();
const download = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    storage: { from: () => ({ download }) },
  }),
}));

import { GET } from '@/app/api/images/[id]/route';
import type { NextRequest } from 'next/server';

const ID = '11111111-1111-1111-1111-111111111111';
const req = (qs = '') => ({ nextUrl: new URL(`http://x/api/images/${ID}${qs}`) }) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

describe('GET /api/images/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } } });
  });

  it('rejects unauthenticated requests without hitting the DB', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns 404 when RLS hides the row', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it('returns 404 when the path is outside the owner folder', async () => {
    maybeSingle.mockResolvedValue({ data: { owner_id: 'o', storage_path: 'other/a.webp', thumb_path: null } });
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it('serves the thumb with a long immutable private cache', async () => {
    maybeSingle.mockResolvedValue({ data: { owner_id: 'o', storage_path: 'o/r/a.webp', thumb_path: 'o/r/a_t.webp' } });
    download.mockResolvedValue({ data: new Blob(['x']), error: null });
    const res = await GET(req('?size=thumb'), ctx());
    expect(res.status).toBe(200);
    expect(download).toHaveBeenCalledWith('o/r/a_t.webp');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });
});
