import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const getUser = vi.fn();
const insert = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      insert,
    }),
  }),
}));
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { saveRecipe } from '@/app/actions/recipes';

const payload = { title: 'Pasta', servings: null, prep_minutes: 0, cook_minutes: 0, total_minutes: 0, ingredients: [{ name: 'sale', quantity: null }], steps: [{ text: 'cuoci' }], category_id: null, tags: [] };

describe('saveRecipe: rate limit sulla creazione', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ id: 'u1' });
    insert.mockReset();
    rpc.mockReset();
  });

  it('con limite superato risponde rate_limited senza inserire', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const r = await saveRecipe(payload, null);
    expect(r).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', expect.objectContaining({ p_bucket: 'recipe_create:u1' }));
  });

  it('la modifica di una ricetta esistente non consuma il rate limit', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await saveRecipe(payload, '00000000-0000-4000-8000-000000000000').catch(() => {});
    expect(rpc).not.toHaveBeenCalled();
  });
});
