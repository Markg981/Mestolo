import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const getUser = vi.fn();
const recipeUpdate = vi.fn();
const nutritionDelete = vi.fn();
let current: Record<string, unknown>;
const snapshot = {
  title: 'Vecchia', description: 'd', original_language: 'it', servings: 4, prep_minutes: 1, cook_minutes: 2, total_minutes: 3,
  ingredients: [{ name: 'farina' }], steps: [{ text: 'x' }], category_id: null, tags: ['a'],
};

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'delete']) c[m] = () => c;
  c.maybeSingle = async () => ({ data: result });
  c.then = (res: (v: unknown) => unknown) => res({ data: [{ id: 'r', public_slug: null }], error: null });
  return c;
}
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (t: string) => {
      if (t === 'recipe_versions') return chain({ snapshot });
      if (t === 'recipe_nutrition') {
        return { delete: () => ({ eq: (...a: unknown[]) => ({ eq: async (...b: unknown[]) => { nutritionDelete(a, b); return { error: null }; } }) }) };
      }
      const c = chain(current) as Record<string, unknown>;
      c.update = (v: unknown) => { recipeUpdate(v); return c; };
      return c;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: vi.fn() }) }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { restoreVersion } from '@/app/actions/recipes';

const RID = '11111111-1111-4111-8111-111111111111';

describe('restoreVersion', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ id: 'u1' });
    recipeUpdate.mockReset();
    nutritionDelete.mockReset();
  });

  it('ripristina tutti i campi dello snapshot', async () => {
    current = { public_slug: null, ingredients: snapshot.ingredients, servings: 4 };
    const r = await restoreVersion(RID, 1, 3);
    expect(r.ok).toBe(true);
    expect(recipeUpdate).toHaveBeenCalledWith(expect.objectContaining(snapshot));
  });

  it('elimina la nutrizione stimata se cambiano gli ingredienti', async () => {
    current = { public_slug: null, ingredients: [{ name: 'zucchero' }], servings: 4 };
    await restoreVersion(RID, 1, 3);
    expect(nutritionDelete).toHaveBeenCalledWith([ 'recipe_id', RID ], [ 'source', 'ai_estimate' ]);
  });

  it('elimina la nutrizione stimata se cambiano le porzioni', async () => {
    current = { public_slug: null, ingredients: snapshot.ingredients, servings: 2 };
    await restoreVersion(RID, 1, 3);
    expect(nutritionDelete).toHaveBeenCalledTimes(1);
  });

  it('non tocca la nutrizione se ingredienti e porzioni sono invariati', async () => {
    current = { public_slug: null, ingredients: snapshot.ingredients, servings: 4 };
    await restoreVersion(RID, 1, 3);
    expect(nutritionDelete).not.toHaveBeenCalled();
  });
});
