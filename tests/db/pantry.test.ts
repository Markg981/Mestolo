/** pantry_items: RLS solo owner (migration 20261026000001), su PostgreSQL reale. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

async function as(uid: string, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;

d('db pantry_items', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('owner can CRUD; another user cannot see, update or delete', async () => {
    const a = await mkUser(`pa_a_${s}`);
    const b = await mkUser(`pa_b_${s}`);
    const id = (await as(a, "insert into public.pantry_items (owner_id, name, expires_on, location) values ($1, 'latte', '2026-12-01', 'fridge') returning id", [a]))[0].id as string;
    expect(await as(a, 'select id from public.pantry_items where id = $1', [id])).toHaveLength(1);
    expect(await as(b, 'select id from public.pantry_items where id = $1', [id])).toHaveLength(0);
    expect(await as(b, "update public.pantry_items set name = 'x' where id = $1 returning id", [id])).toHaveLength(0);
    expect(await as(b, 'delete from public.pantry_items where id = $1 returning id', [id])).toHaveLength(0);
    expect(await as(a, "update public.pantry_items set note = 'ok' where id = $1 returning id", [id])).toHaveLength(1);
    expect(await as(a, 'delete from public.pantry_items where id = $1 returning id', [id])).toHaveLength(1);
  });

  it('cannot insert on behalf of another user nor reassign ownership', async () => {
    const a = await mkUser(`pa_c_${s}`);
    const b = await mkUser(`pa_d_${s}`);
    await expect(as(a, "insert into public.pantry_items (owner_id, name) values ($1, 'x')", [b])).rejects.toThrow();
    const id = (await as(a, "insert into public.pantry_items (owner_id, name) values ($1, 'y') returning id", [a]))[0].id as string;
    await expect(as(a, 'update public.pantry_items set owner_id = $2 where id = $1', [id, b])).rejects.toThrow();
  });
});
