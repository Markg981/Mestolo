import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));

function chain(): unknown {
  const p: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(state.result) : () => p),
  });
  return p;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => chain() }),
  getUser: async () => ({ id: '00000000-0000-0000-0000-000000000001' }),
}));

import { getRecipeDetail, listCategories, listCollections } from '@/lib/data/recipes';

describe('loader recipes: errori del DB', () => {
  beforeEach(() => {
    state.result = { data: null, error: null };
  });

  it("propaga l'errore invece di restituire []", async () => {
    state.result = { data: null, error: { message: 'connection refused' } };
    await expect(listCategories()).rejects.toThrow(/connection refused/);
    await expect(listCollections()).rejects.toThrow(/connection refused/);
  });

  it('getRecipeDetail propaga l\'errore ma restituisce null se non trovata', async () => {
    const id = '00000000-0000-0000-0000-0000000000aa';
    state.result = { data: null, error: { message: 'boom' } };
    await expect(getRecipeDetail(id)).rejects.toThrow(/boom/);
    state.result = { data: null, error: null };
    await expect(getRecipeDetail(id)).resolves.toBeNull();
  });
});
