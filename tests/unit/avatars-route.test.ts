import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaims = vi.fn();
const rpc = vi.fn();
const download = vi.fn();
const fromBucket = vi.fn<(bucket: string) => { download: typeof download }>(() => ({ download }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims }, rpc, storage: { from: fromBucket } }),
}));

import { GET } from '@/app/api/avatars/[userId]/route';
import type { NextRequest } from 'next/server';

const UID = '33333333-3333-3333-3333-333333333333';
const req = () => ({}) as unknown as NextRequest;
const ctx = (userId = UID) => ({ params: Promise.resolve({ userId }) });

describe('GET /api/avatars/[userId]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fromBucket.mockImplementation(() => ({ download }));
    getClaims.mockResolvedValue({ data: { claims: { sub: 'viewer' } } });
  });

  it('returns 404 for a malformed user id without any lookup', async () => {
    expect((await GET(req(), ctx('not-a-uuid'))).status).toBe(404);
    expect((await GET(req(), ctx(`${UID}/../x`))).status).toBe(404);
    expect(getClaims).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('resolves the path through get_avatar_paths for the requested user only', async () => {
    rpc.mockResolvedValue({ data: [] });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(rpc).toHaveBeenCalledWith('get_avatar_paths', { p_ids: [UID] });
    expect(download).not.toHaveBeenCalled();
  });

  it('returns 404 when the profile has no visible avatar', async () => {
    rpc.mockResolvedValue({ data: [{ id: UID, avatar_path: null }] });
    expect((await GET(req(), ctx())).status).toBe(404);
    rpc.mockResolvedValue({ data: null });
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it('returns 404 when the returned path is not inside the user folder', async () => {
    rpc.mockResolvedValue({ data: [{ id: UID, avatar_path: 'someone-else/a.webp' }] });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it('returns 404 when the storage download fails', async () => {
    rpc.mockResolvedValue({ data: [{ id: UID, avatar_path: `${UID}/a.webp` }] });
    download.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it('serves the avatar with a short private cache and hardening headers', async () => {
    rpc.mockResolvedValue({ data: [{ id: UID, avatar_path: `${UID}/a.webp` }] });
    download.mockResolvedValue({ data: new Blob(['img']), error: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(fromBucket).toHaveBeenCalledWith('avatars');
    expect(download).toHaveBeenCalledWith(`${UID}/a.webp`);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(await res.text()).toBe('img');
  });
});
