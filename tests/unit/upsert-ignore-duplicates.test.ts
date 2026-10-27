import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
const getUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (t: string) => ({
      upsert: async (...a: unknown[]) => (upsert(t, ...a), { error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f }));
vi.mock('@/lib/rate-limit', () => ({ RateLimitedError: class RateLimitedError extends Error {}, enforceRateLimit: vi.fn() }));

import { toggleFavorite } from '@/app/actions/recipes';
import { setRecipeInCollection } from '@/app/actions/organize';
import { blockUser } from '@/app/actions/social';

const A = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';
const B = '4f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5c';

// Le tabelle non hanno policy UPDATE: ON CONFLICT DO UPDATE fallirebbe al secondo invio.
describe('upsert idempotenti (nessuna policy UPDATE)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ id: A });
  });

  it('favorites', async () => {
    await toggleFavorite(B, true);
    expect(upsert).toHaveBeenCalledWith('favorites', expect.anything(), { onConflict: 'user_id,recipe_id', ignoreDuplicates: true });
  });
  it('collection_recipes', async () => {
    await setRecipeInCollection(A, B, true);
    expect(upsert).toHaveBeenCalledWith('collection_recipes', expect.anything(), { onConflict: 'collection_id,recipe_id', ignoreDuplicates: true });
  });
  it('blocks', async () => {
    await blockUser(B);
    expect(upsert).toHaveBeenCalledWith('blocks', expect.anything(), { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  });
});
