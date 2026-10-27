import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const remove = vi.fn();
let delRes: { data: unknown; error: { code?: string; message?: string } | null };
let removeRes: { error: { message: string } | null };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { recipe_id: 'r', storage_path: 'a', thumb_path: 'b' } }) }) }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ select: async () => delRes }) }) }),
    }),
    storage: { from: () => ({ remove: (p: string[]) => (remove(p), Promise.resolve(removeRes)) }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { deleteRecipeImage } from '@/app/actions/images';

const ID = '11111111-1111-4111-8111-111111111111';

describe('deleteRecipeImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ id: 'u' });
    delRes = { data: [{ id: ID }], error: null };
    removeRes = { error: null };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('errore DB: non rimuove i file e restituisce errore', async () => {
    delRes = { data: null, error: { code: 'XX000', message: 'boom' } };
    const r = await deleteRecipeImage(ID);
    expect(r.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('nessuna riga cancellata: non rimuove i file', async () => {
    delRes = { data: [], error: null };
    const r = await deleteRecipeImage(ID);
    expect(r.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('successo: rimuove i file; errore storage solo loggato', async () => {
    removeRes = { error: { message: 'storage down' } };
    const r = await deleteRecipeImage(ID);
    expect(r.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(['a', 'b']);
  });
});
