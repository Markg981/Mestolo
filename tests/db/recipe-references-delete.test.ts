/**
 * ON DELETE SET NULL dei riferimenti tra ricette (migration 20261025035000): eliminare una ricetta con
 * varianti o copiata da altri, o l'account del suo autore, non fallisce piu' per violazione della FK,
 * e il client continua a non poter azzerare l'attribuzione.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

async function as<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
const mkUser = async (name: string) =>
  (await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id;
const refs = async (rid: string) =>
  (await admin<{ parent: string | null; copied: string | null; author: string | null; name: string | null }>(
    'select parent_recipe_id as parent, copied_from_recipe_id as copied, original_author_id as author, original_author_name as name from public.recipes where id = $1',
    [rid],
  ))[0];

d('db recipe references on delete', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  const recipe = async (uid: string, title: string, extra: Record<string, string> = {}) => {
    const cols = ['owner_id', 'title', 'visibility', ...Object.keys(extra)];
    const vals = [uid, title, 'public', ...Object.values(extra)];
    return (await as<{ id: string }>(uid, `insert into public.recipes (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals))[0].id;
  };

  it('the owner can delete a recipe that has variants', async () => {
    const u = await mkUser(`rd_v_${s}`);
    const base = await recipe(u, 'Base');
    const variant = await recipe(u, 'Variante', { parent_recipe_id: base });
    expect(await as(u, 'delete from public.recipes where id = $1 returning id', [base])).toHaveLength(1);
    expect((await refs(variant)).parent).toBeNull();
  });

  it('the owner can delete a recipe that someone else copied; the copy keeps its attribution', async () => {
    const a = await mkUser(`rd_a_${s}`);
    const b = await mkUser(`rd_b_${s}`);
    const src = await recipe(a, 'Fonte');
    const copy = await recipe(b, 'Copia', { copied_from_recipe_id: src, original_author_id: a });
    expect(await as(a, 'delete from public.recipes where id = $1 returning id', [src])).toHaveLength(1);
    expect(await refs(copy)).toEqual({ parent: null, copied: null, author: a, name: `@rd_a_${s}` });
  });

  it('deleting the author account keeps the copies of other users', async () => {
    const a = await mkUser(`rd_x_${s}`);
    const b = await mkUser(`rd_y_${s}`);
    const src = await recipe(a, 'Fonte');
    const copy = await recipe(b, 'Copia', { copied_from_recipe_id: src, original_author_id: a });
    await admin('delete from auth.users where id = $1', [a]);
    expect(await refs(copy)).toEqual({ parent: null, copied: null, author: null, name: `@rd_x_${s}` });
  });

  it('a client still cannot clear the attribution while the source exists', async () => {
    const a = await mkUser(`rd_c_${s}`);
    const b = await mkUser(`rd_d_${s}`);
    const src = await recipe(a, 'Fonte');
    const base = await recipe(b, 'Base');
    const copy = await recipe(b, 'Copia', { copied_from_recipe_id: src, original_author_id: a, parent_recipe_id: base });
    await as(b, 'update public.recipes set copied_from_recipe_id = null, original_author_id = null, parent_recipe_id = null where id = $1', [copy]);
    expect(await refs(copy)).toEqual({ parent: base, copied: src, author: a, name: `@rd_c_${s}` });
  });
});
