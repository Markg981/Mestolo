import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const revalidatePath = vi.fn();
const remove = vi.fn();
const bucket = vi.fn();
const ops: { op: string; eqs: [string, unknown][] }[] = [];
let selectRes: { data: unknown };
let deleteRes: { data: unknown; error: unknown };

function builder() {
  const st = { op: 'select', eqs: [] as [string, unknown][] };
  ops.push(st);
  const b: Record<string, unknown> = {
    select: () => b,
    delete: () => ((st.op = 'delete'), b),
    eq: (c: string, v: unknown) => (st.eqs.push([c, v]), b),
    maybeSingle: async () => selectRes,
    // `await ...delete().eq().select()` resolves here
    then: (res: (v: unknown) => unknown) => Promise.resolve(deleteRes).then(res),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: (b: string) => (bucket(b), { remove }) } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/rate-limit', () => ({ RateLimitedError: class RateLimitedError extends Error {}, enforceRateLimit: vi.fn() }));

import { deleteCookLog } from '@/app/actions/cooklogs';

const ID = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';

describe('deleteCookLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ops.length = 0;
    getUser.mockResolvedValue({ id: 'u1' });
    selectRes = { data: { recipe_id: 'r1', photo_path: 'u1/cook/x.webp' } };
    deleteRes = { data: [{ id: ID }], error: null };
    remove.mockResolvedValue({ error: null });
  });

  it('rejects unauthenticated callers without touching the db', async () => {
    getUser.mockResolvedValue(null);
    expect(await deleteCookLog(ID)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(ops).toHaveLength(0);
  });

  it('rejects ids that are not uuids', async () => {
    expect(await deleteCookLog('not-a-uuid')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(ops).toHaveLength(0);
  });

  it('returns not_found when the log is not visible, and deletes nothing', async () => {
    selectRes = { data: null };
    expect(await deleteCookLog(ID)).toMatchObject({ ok: false, error: 'not_found' });
    expect(ops.map((o) => o.op)).toEqual(['select']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes by id, removes the photo from the recipe-images bucket and revalidates', async () => {
    expect(await deleteCookLog(ID)).toEqual({ ok: true, data: undefined });
    expect(ops[1]).toEqual({ op: 'delete', eqs: [['id', ID]] });
    expect(bucket).toHaveBeenCalledWith('recipe-images');
    expect(remove).toHaveBeenCalledWith(['u1/cook/x.webp']);
    expect(revalidatePath).toHaveBeenCalledWith('/recipes/r1');
    expect(revalidatePath).toHaveBeenCalledWith('/recipes/cooked');
  });

  it('does not touch storage when the log has no photo', async () => {
    selectRes = { data: { recipe_id: 'r1', photo_path: null } };
    expect(await deleteCookLog(ID)).toMatchObject({ ok: true });
    expect(remove).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('is forbidden when RLS filters the row out of the delete (zero rows), keeping the photo', async () => {
    deleteRes = { data: [], error: null };
    expect(await deleteCookLog(ID)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(remove).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates a database error and keeps the photo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteRes = { data: null, error: { code: '42501', message: 'row-level security' } };
    expect(await deleteCookLog(ID)).toMatchObject({ ok: false, error: 'forbidden' });
    deleteRes = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await deleteCookLog(ID)).toMatchObject({ ok: false, error: 'generic' });
    expect(remove).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
