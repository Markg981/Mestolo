import { beforeEach, describe, expect, it, vi } from 'vitest';

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';
const USER = { id: '22222222-2222-4222-8222-222222222222' };
const recipe = { title: 'Pasta', description: '', ingredients: [{ name: 'pasta' }] };

const rpc = vi.fn();
const generateImage = vi.fn();
const resolveProvider = vi.fn();
let overQuota = false;

function chain() {
  const self: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: null, error: null });
      if (prop === 'maybeSingle') return async () => ({ data: recipe, error: null });
      return () => self;
    },
  });
  return self;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), enforceRateLimit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => USER,
  getProfile: async () => ({ locale: 'it' }),
  createClient: async () => ({ from: () => chain(), rpc: async () => ({ data: 'new-id', error: null }) }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => {
      rpc(...a);
      return Promise.resolve({ data: null, error: null });
    },
    from: () => chain(),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
  }),
}));
vi.mock('@/lib/ai/service', () => ({
  resolveProvider: (...a: unknown[]) => resolveProvider(...a),
  recordUsage: vi.fn(async () => {}),
}));
vi.mock('@/lib/images/process', () => ({
  ImageValidationError: class ImageValidationError extends Error {},
  processRecipeImage: async () => ({ full: Buffer.from('a'), thumb: Buffer.from('b'), width: 1, height: 1 }),
}));
vi.mock('@/lib/images/quota', () => ({ userOverImageQuota: async () => overQuota }));

import { generateRecipeImage } from '@/app/actions/images';
import { withRefund } from '@/lib/ai/refund';

const resolved = { provider: { id: 'app', generateImage }, keySource: 'app', providerName: 'App' };

beforeEach(() => {
  vi.clearAllMocks();
  overQuota = false;
  resolveProvider.mockResolvedValue(resolved);
});

describe('withRefund', () => {
  it('refunds only if the provider fails before paid()', async () => {
    await expect(
      withRefund(USER.id, resolved as never, 'text', 'x', async () => {
        throw new Error('503');
      }),
    ).rejects.toThrow('503');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not refund an ai_bad_output result', async () => {
    const r = await withRefund(USER.id, resolved as never, 'text', 'x', async (paid) => {
      paid();
      return { ok: false, error: 'ai_bad_output' };
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not refund a throw after the provider answered', async () => {
    await expect(
      withRefund(USER.id, resolved as never, 'text', 'x', async (paid) => {
        paid();
        throw new Error('db');
      }),
    ).rejects.toThrow('db');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('generateRecipeImage: storage quota', () => {
  it('blocks before consuming AI quota or calling the provider', async () => {
    overQuota = true;
    const res = await generateRecipeImage(RECIPE_ID, true);
    expect(res).toMatchObject({ ok: false, error: 'storage_quota_exceeded' });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
