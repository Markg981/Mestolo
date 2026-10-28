import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const RID = '11111111-1111-4111-8111-111111111111';
const recipe = { id: RID, original_language: 'it', content_hash: 'h', title: 'T', description: '', ingredients: [], steps: [] };

const rpc = vi.fn();
const completeJson = vi.fn();
let claimResult = true;

vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => ({ id: 'u1' }),
  getProfile: async () => ({ locale: 'it' }),
  createClient: async () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: t === 'recipes' ? recipe : null }) }) }),
    }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc, from: () => ({ upsert: async () => ({ error: null }) }) }),
}));
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), enforceRateLimit: vi.fn() }));
vi.mock('@/lib/ai/service', () => ({ resolveProvider: async () => ({ provider: { id: 'p', completeJson } }), recordUsage: vi.fn() }));
vi.mock('@/lib/ai/refund', () => ({ withRefund: async (_u: unknown, _r: unknown, _a: unknown, _b: unknown, fn: (p: () => void) => unknown) => fn(() => undefined) }));

import { translateRecipe } from './ai';

beforeEach(() => {
  rpc.mockReset();
  completeJson.mockReset();
  claimResult = true;
  rpc.mockImplementation(async (name: string) => (name === 'claim_translation_lock' ? { data: claimResult, error: null } : { data: null, error: null }));
});

describe('translateRecipe lock (L-14)', () => {
  it('se il lock e gia preso non chiama il provider', async () => {
    claimResult = false;
    const res = await translateRecipe(RID, 'en');
    expect(res).toMatchObject({ ok: false, error: 'conflict' });
    expect(completeJson).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('release_translation_lock', expect.anything());
  });

  it('rilascia il lock anche se il provider fallisce', async () => {
    completeJson.mockRejectedValue(new Error('boom'));
    const res = await translateRecipe(RID, 'en');
    expect(res.ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith('release_translation_lock', { p_recipe: RID, p_locale: 'en' });
  });

  it('rilascia il lock dopo il successo', async () => {
    completeJson.mockResolvedValue({ title: 'T', description: '', ingredients: [], steps: [] });
    const res = await translateRecipe(RID, 'en');
    expect(res).toMatchObject({ ok: true, data: { cached: false } });
    expect(rpc).toHaveBeenCalledWith('release_translation_lock', { p_recipe: RID, p_locale: 'en' });
  });
});
