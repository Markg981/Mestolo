import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

const getUser = vi.fn();
// stato simulato: versione corrente della ricetta e esito dell'upsert nota
const state = { version: 3, noteFails: false, noteBody: null as string | null };
const upsert = vi.fn(async (row: { body: string }) => {
  if (state.noteFails) return { error: { code: 'XX000', message: 'boom' } };
  state.noteBody = row.body;
  return { error: null };
});

function recipesTable() {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {
    eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
    select: () => chain,
    maybeSingle: async () => ({ data: filters.version === undefined || filters.version === state.version ? { id: 'r', public_slug: null } : null, error: null }),
    update: () => { return chain; },
  };
  chain.update = () => {
    const c: Record<string, unknown> = {
      eq: (k: string, v: unknown) => { filters[k] = v; return c; },
      select: () => c,
      maybeSingle: async () => {
        if (filters.version !== state.version) return { data: null, error: null };
        state.version += 1;
        return { data: { id: 'r', public_slug: null }, error: null };
      },
    };
    return c;
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (t: string) => (t === 'recipes' ? recipesTable() : { upsert }),
  }),
}));

import { saveRecipe } from '@/app/actions/recipes';

const id = '00000000-0000-4000-8000-000000000001';
const payload = { title: 'Pasta', servings: null, prep_minutes: 0, cook_minutes: 0, total_minutes: 0, ingredients: [{ name: 'sale', quantity: null }], steps: [{ text: 'cuoci' }], category_id: null, tags: [], personal_note: 'mia nota' };

describe('saveRecipe: nota personale e retry', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ id: 'u1' });
    state.version = 3;
    state.noteFails = false;
    state.noteBody = null;
    upsert.mockClear();
  });

  it('se la nota fallisce la ricetta non avanza di versione e il retry completa senza conflict', async () => {
    state.noteFails = true;
    const first = await saveRecipe(payload, id, 3);
    expect(first.ok).toBe(false);
    expect(state.version).toBe(3);

    state.noteFails = false;
    const retry = await saveRecipe(payload, id, 3);
    expect(retry).toMatchObject({ ok: true });
    expect(state.version).toBe(4);
    expect(state.noteBody).toBe('mia nota');
  });

  it('con versione obsoleta risponde conflict senza toccare la nota', async () => {
    const r = await saveRecipe(payload, id, 2);
    expect(r).toMatchObject({ ok: false, error: 'conflict' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
