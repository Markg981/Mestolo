import { beforeEach, describe, expect, it, vi } from 'vitest';

const SHARED = '11111111-1111-4111-8111-111111111111';
const OWN = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const RECIPE = '44444444-4444-4444-8444-444444444444';

// Liste visibili all'utente (RLS: proprie + condivise). FOREIGN non e' tra queste.
const visibleLists = [SHARED, OWN];
const inserts: { list_id: string }[] = [];

function builder(table: string) {
  const state: { eqId?: string } = {};
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain;
  b.order = chain;
  b.limit = chain;
  b.eq = (col: string, v: string) => {
    if (col === 'id' || col === 'list_id') state.eqId = v;
    return b;
  };
  b.maybeSingle = async () => {
    if (table === 'recipes') return { data: { id: RECIPE, title: 'Torta', servings: null, ingredients: [{ name: 'farina', quantity: 200, unit: 'g' }] } };
    if (table === 'shopping_lists') return { data: state.eqId && visibleLists.includes(state.eqId) ? { id: state.eqId } : null };
    return { data: null };
  };
  b.insert = async (rows: { list_id: string }[]) => {
    inserts.push(...rows);
    return { error: null };
  };
  // select su shopping_items: nessun elemento esistente
  b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: builder,
    // add_shopping_items fa merge + insert in un'unica transazione: la lista di destinazione e' p_list_id.
    rpc: async (fn: string, args: { p_list_id?: string }) => {
      if (fn !== 'add_shopping_items') return { data: 0, error: null };
      inserts.push({ list_id: args.p_list_id as string });
      return { data: { added: 1, merged: 0 }, error: null };
    },
  }),
  getUser: async () => ({ id: 'me' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addRecipeToShopping } from '@/app/actions/planning';

describe('addRecipeToShopping con lista di destinazione', () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("scrive nella lista condivisa quando l'utente vi ha accesso", async () => {
    const res = await addRecipeToShopping(RECIPE, null, undefined, SHARED);
    expect(res.ok).toBe(true);
    expect(inserts.map((i) => i.list_id)).toEqual([SHARED]);
  });

  it('rifiuta un listId non accessibile senza scrivere nulla', async () => {
    const res = await addRecipeToShopping(RECIPE, null, undefined, FOREIGN);
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('rifiuta un listId non valido', async () => {
    const res = await addRecipeToShopping(RECIPE, null, undefined, 'non-un-uuid');
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
