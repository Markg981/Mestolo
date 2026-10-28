import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const nutInsert = vi.fn();
let nutRow: Record<string, unknown> | null;
let nutInsertError: { message: string } | null;
let nutSelectThrows = false;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/data/public-recipes', () => ({ PUBLIC_RECIPES_TAG: 'p', publicRecipeTag: (s: string) => s }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => {} }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'recipe_nutrition') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => { if (nutSelectThrows) throw new Error('boom'); return { data: nutRow }; } }) }),
          insert: async (row: unknown) => (nutInsert(row), { error: nutInsertError }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: SRC, owner_id: 'u1', title: 't', ingredients: [], steps: [], tags: [], field_flags: {} } }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new' }, error: null }) }) }),
      };
    },
  }),
}));

import { copyRecipe } from '@/app/actions/recipes';

const SRC = '11111111-1111-4111-8111-111111111111';

describe('copyRecipe: nutrizione', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockResolvedValue({ id: 'u2' });
    nutInsertError = null;
    nutSelectThrows = false;
  });

  it('copia le righe di nutrizione sulla nuova ricetta', async () => {
    nutRow = { recipe_id: SRC, energy_kcal: 250, protein_g: 10, source: 'manual', updated_at: 'x' };
    const res = await copyRecipe(SRC, 'copy');
    expect(res).toMatchObject({ ok: true });
    expect(nutInsert).toHaveBeenCalledWith({ recipe_id: 'new', energy_kcal: 250, protein_g: 10, source: 'manual' });
  });

  it('senza nutrizione visibile non inserisce nulla', async () => {
    nutRow = null;
    const res = await copyRecipe(SRC, 'copy');
    expect(res).toMatchObject({ ok: true });
    expect(nutInsert).not.toHaveBeenCalled();
  });

  it('fail-soft: errore di insert o lettura non fa fallire la copia', async () => {
    nutRow = { recipe_id: SRC, energy_kcal: 1, source: 'manual' };
    nutInsertError = { message: 'x' };
    expect(await copyRecipe(SRC, 'copy')).toMatchObject({ ok: true });
    nutSelectThrows = true;
    expect(await copyRecipe(SRC, 'copy')).toMatchObject({ ok: true });
  });
});
