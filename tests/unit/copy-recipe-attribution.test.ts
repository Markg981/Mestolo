import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const insert = vi.fn();
let source: Record<string, unknown>;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/data/public-recipes', () => ({ PUBLIC_RECIPES_TAG: 'p', publicRecipeTag: (s: string) => s }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => {} }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: source }) }) }),
      insert: (row: unknown) => (insert(row), { select: () => ({ single: async () => ({ data: { id: 'new' }, error: null }) }) }),
    }),
  }),
}));

import { copyRecipe } from '@/app/actions/recipes';

const SRC = '11111111-1111-4111-8111-111111111111';
const base = { title: 't', ingredients: [], steps: [], tags: [], field_flags: {} };

describe('copyRecipe: catena di attribuzione', () => {
  beforeEach(() => vi.clearAllMocks());

  it('copia di una ricetta altrui: attribuisce all autore originale e punta alla sorgente', async () => {
    getUser.mockResolvedValue({ id: 'u2' });
    source = { ...base, id: SRC, owner_id: 'u1', original_author_id: null, copied_from_recipe_id: null };
    await copyRecipe(SRC, 'copy');
    expect(insert.mock.calls[0][0]).toMatchObject({ original_author_id: 'u1', copied_from_recipe_id: SRC });
  });

  it('copia di una propria copia (B->C): mantiene autore e ricetta di origine di B', async () => {
    getUser.mockResolvedValue({ id: 'u2' });
    source = { ...base, id: SRC, owner_id: 'u2', original_author_id: 'u1', copied_from_recipe_id: 'recipe-a' };
    await copyRecipe(SRC, 'copy');
    expect(insert.mock.calls[0][0]).toMatchObject({ original_author_id: 'u1', copied_from_recipe_id: 'recipe-a' });
  });

  it('copia di una propria ricetta originale: nessuna attribuzione', async () => {
    getUser.mockResolvedValue({ id: 'u1' });
    source = { ...base, id: SRC, owner_id: 'u1', original_author_id: null, copied_from_recipe_id: null };
    await copyRecipe(SRC, 'copy');
    expect(insert.mock.calls[0][0]).toMatchObject({ original_author_id: null, copied_from_recipe_id: null });
  });
});
