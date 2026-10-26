import { beforeEach, describe, expect, it, vi } from 'vitest';

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';
const USER = { id: '22222222-2222-4222-8222-222222222222' };

const { safeFetch, owned, getUser } = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  owned: { value: null as unknown },
  getUser: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/import/safe-fetch', () => ({ safeFetch }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getUser,
  createClient: async () => {
    const c: Record<string, unknown> = {};
    const self: unknown = new Proxy(c, {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'maybeSingle') return async () => ({ data: owned.value, error: null });
        return () => self;
      },
    });
    return self;
  },
}));

import { importSourceImage } from '@/app/actions/images';

describe('importSourceImage', () => {
  beforeEach(() => {
    safeFetch.mockReset();
    getUser.mockResolvedValue(USER);
    owned.value = null;
  });

  it('does not fetch when the caller does not own the recipe', async () => {
    const r = await importSourceImage(RECIPE_ID, 'https://example.com/a.jpg', null);
    expect(r.ok).toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('rejects an over-long attribution before fetching', async () => {
    owned.value = { id: RECIPE_ID };
    const r = await importSourceImage(RECIPE_ID, 'https://example.com/a.jpg', 'x'.repeat(301));
    expect(r.ok).toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('rejects a non-string attribution', async () => {
    owned.value = { id: RECIPE_ID };
    const r = await importSourceImage(RECIPE_ID, 'https://example.com/a.jpg', { a: 1 } as unknown as string);
    expect(r.ok).toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
