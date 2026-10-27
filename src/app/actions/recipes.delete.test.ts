import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/data/public-recipes', () => ({ PUBLIC_RECIPES_TAG: 'p', publicRecipeTag: (s: string) => s }));

const RID = '11111111-1111-4111-8111-111111111111';
const remove = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));

function client() {
  return {
    storage: { from: () => ({ remove }) },
    from: (table: string) => {
      const rows = table === 'recipe_images' ? [{ storage_path: 'a.jpg', thumb_path: 'a_t.jpg' }] : [{ id: RID }];
      const q: Record<string, unknown> = {
        select: () => q,
        delete: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { public_slug: null } }),
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ getUser: async () => ({ id: 'u1' }), createClient: async () => client() }));

import { deleteRecipe } from './recipes';

describe('deleteRecipe', () => {
  it('se storage.remove fallisce restituisce ok e registra l\'errore', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await deleteRecipe(RID);
    expect(res.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(['a.jpg', 'a_t.jpg']);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(`recipe=${RID} paths=2`));
    spy.mockRestore();
  });
});
