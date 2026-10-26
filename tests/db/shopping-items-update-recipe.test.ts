/** shopping_items_update deve validare recipe_id come l'insert (migration 20261103000002). */
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

async function createUser(username: string): Promise<string> {
  const r = await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [
    `${username}@example.test`,
    JSON.stringify({ username, locale: 'it' }),
  ]);
  return r.rows[0].id;
}

d('shopping_items_update: validazione recipe_id', () => {
  let user: string;
  let other: string;
  let item: string;
  let privateRecipe: string;
  let publicRecipe: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    user = await createUser(`sru_${s}`);
    other = await createUser(`srt_${s}`);
    const list = (await pool.query('select id from public.shopping_lists where owner_id = $1', [user])).rows[0].id;
    item = (await as<{ id: string }>(user, "insert into public.shopping_items (list_id, name) values ($1, 'uova') returning id", [list]))[0].id;
    privateRecipe = (await as<{ id: string }>(other, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Privata', 'private') returning id", [other]))[0].id;
    publicRecipe = (await as<{ id: string }>(other, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pubblica', 'public') returning id", [other]))[0].id;
  });

  afterAll(async () => {
    await pool?.query('delete from auth.users where id = any($1)', [[user, other]]);
    await pool?.end();
  });

  it('rifiuta di puntare un articolo a una ricetta non visibile', async () => {
    await expect(as(user, 'update public.shopping_items set recipe_id = $2 where id = $1', [item, privateRecipe])).rejects.toThrow(/row-level security/);
  });

  it('consente una ricetta visibile e il reset a null', async () => {
    expect(await as(user, 'update public.shopping_items set recipe_id = $2 where id = $1 returning id', [item, publicRecipe])).toHaveLength(1);
    expect(await as(user, 'update public.shopping_items set recipe_id = null where id = $1 returning id', [item])).toHaveLength(1);
  });
});
