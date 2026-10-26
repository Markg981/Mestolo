import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublicCoverPaths, downloadPublicCover } = vi.hoisted(() => ({ getPublicCoverPaths: vi.fn(), downloadPublicCover: vi.fn() }));
vi.mock('@/lib/data/public-recipes', () => ({ getPublicCoverPaths, downloadPublicCover }));

import { GET } from '@/app/api/public-images/[id]/route';
import { NextRequest } from 'next/server';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const call = () => GET(new NextRequest(`http://localhost/api/public-images/${ID}`), { params: Promise.resolve({ id: ID }) });

describe('GET /api/public-images/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serves the cover with a short shared cache and no stale-while-revalidate', async () => {
    getPublicCoverPaths.mockResolvedValue({ storage_path: 'a.webp', thumb_path: null });
    downloadPublicCover.mockResolvedValue(new Blob(['x']));
    const res = await call();
    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).not.toContain('stale-while-revalidate');
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(cc)?.[1]);
    expect(sMaxAge).toBeGreaterThanOrEqual(60);
    expect(sMaxAge).toBeLessThanOrEqual(300);
  });

  it('returns 404 without cache headers when the cover is no longer public', async () => {
    getPublicCoverPaths.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBeNull();
  });
});
