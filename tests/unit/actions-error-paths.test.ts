import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
let res: { data: unknown; error: unknown };
const calls: string[] = [];

function builder() {
  const b: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r),
  };
  for (const m of ['insert', 'update', 'delete', 'upsert', 'select', 'eq']) {
    b[m] = () => {
      calls.push(m);
      return b;
    };
  }
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addPantryItem, updatePantryItem, deletePantryItem } from '@/app/actions/pantry';
import { rateRecipe } from '@/app/actions/ratings';
import { setItemAisle, addShoppingMember, removeShoppingMember, renameShoppingList } from '@/app/actions/shopping';

const ID = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';
const OTHER = '4a2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5c';
const dbError = { message: 'boom', code: 'XX000' };

beforeEach(() => {
  getUser.mockResolvedValue({ id: OTHER });
  res = { data: [{ id: ID }], error: null };
  calls.length = 0;
});

describe('pantry', () => {
  it('rifiuta utente assente o input non valido', async () => {
    getUser.mockResolvedValue(null);
    expect(await addPantryItem({ name: 'x' })).toMatchObject({ ok: false, error: 'invalid_input' });
    getUser.mockResolvedValue({ id: OTHER });
    expect(await addPantryItem({ name: '   ' })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await addPantryItem({ name: 'x', location: 'attic' })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await updatePantryItem('non-uuid', { name: 'x' })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await deletePantryItem('non-uuid')).toMatchObject({ ok: false, error: 'invalid_input' });
  });
  it("propaga l'errore DB senza ok", async () => {
    res = { data: null, error: dbError };
    expect(await addPantryItem({ name: 'x' })).toMatchObject({ ok: false });
    expect(await updatePantryItem(ID, { name: 'x' })).toMatchObject({ ok: false });
    expect(await deletePantryItem(ID)).toMatchObject({ ok: false });
  });
  it('ok sul percorso felice', async () => {
    expect(await addPantryItem({ name: 'farina', quantity: 2 })).toMatchObject({ ok: true });
    expect(await updatePantryItem(ID, { name: 'farina' })).toMatchObject({ ok: true });
    expect(await deletePantryItem(ID)).toMatchObject({ ok: true });
  });
});

describe('ratings', () => {
  it('valida stelle e id', async () => {
    expect(await rateRecipe(ID, 0)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await rateRecipe(ID, 6)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await rateRecipe(ID, 2.5)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await rateRecipe('x', 3)).toMatchObject({ ok: false, error: 'invalid_input' });
    getUser.mockResolvedValue(null);
    expect(await rateRecipe(ID, 3)).toMatchObject({ ok: false, error: 'invalid_input' });
  });
  it("update prima dell'insert: nessun insert se la riga esiste", async () => {
    expect(await rateRecipe(ID, 4)).toMatchObject({ ok: true });
    expect(calls).not.toContain('insert');
  });
  it("inserisce quando l'update non tocca righe", async () => {
    res = { data: [], error: null };
    expect(await rateRecipe(ID, 4)).toMatchObject({ ok: true });
    expect(calls).toContain('insert');
  });
  it('rimuove il voto con null e propaga errori DB', async () => {
    expect(await rateRecipe(ID, null)).toMatchObject({ ok: true });
    expect(calls).toContain('delete');
    res = { data: null, error: dbError };
    expect(await rateRecipe(ID, null)).toMatchObject({ ok: false });
    expect(await rateRecipe(ID, 3)).toMatchObject({ ok: false });
  });
});

describe('shopping', () => {
  it('setItemAisle valida nome, lista e reparto', async () => {
    expect(await setItemAisle('x', 'latte', null)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await setItemAisle(ID, '   ', null)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await setItemAisle(ID, 'latte', 'not-an-aisle')).toMatchObject({ ok: false, error: 'invalid_input' });
  });
  it('setItemAisle: reset (delete) e errore DB', async () => {
    expect(await setItemAisle(ID, 'latte', null)).toMatchObject({ ok: true });
    expect(calls).toContain('delete');
    res = { data: null, error: dbError };
    expect(await setItemAisle(ID, 'latte', null)).toMatchObject({ ok: false });
  });
  it('addShoppingMember: non invita se stessi, duplicato ok, altri errori falliscono', async () => {
    expect(await addShoppingMember(ID, OTHER)).toMatchObject({ ok: false, error: 'invalid_input' });
    res = { data: null, error: { message: 'dup', code: '23505' } };
    expect(await addShoppingMember(ID, ID)).toMatchObject({ ok: true });
    res = { data: null, error: dbError };
    expect(await addShoppingMember(ID, ID)).toMatchObject({ ok: false });
  });
  it('removeShoppingMember: input e errore DB', async () => {
    expect(await removeShoppingMember('x', ID)).toMatchObject({ ok: false, error: 'invalid_input' });
    res = { data: null, error: dbError };
    expect(await removeShoppingMember(ID, ID)).toMatchObject({ ok: false });
  });
  it('renameShoppingList: nome vuoto/lungo, non proprietario, ok', async () => {
    expect(await renameShoppingList(ID, '  ')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await renameShoppingList(ID, 'a'.repeat(81))).toMatchObject({ ok: false, error: 'invalid_input' });
    res = { data: [], error: null };
    expect(await renameShoppingList(ID, 'Spesa')).toMatchObject({ ok: false, error: 'forbidden' });
    res = { data: [{ id: ID }], error: null };
    expect(await renameShoppingList(ID, 'Spesa')).toMatchObject({ ok: true });
  });
});
