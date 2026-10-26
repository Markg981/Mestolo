/**
 * A-12 (migration 20261102000009): chiave di idempotenza sulla creazione ricette e
 * inserimento atomico di posizione/quota per le immagini.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

async function asUser<T>(uid: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

d('db idempotency key and atomic image insert', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let uid: string;
  let rid: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
    uid = (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`ia_${s}@example.test`, JSON.stringify({ username: `ia_${s}` })]))[0].id;
    rid = (await admin("insert into public.recipes (owner_id, title) values ($1, 'R') returning id", [uid]))[0].id;
  });
  afterAll(async () => pool?.end());

  it('rejects a second recipe with the same (owner, idempotency_key)', async () => {
    const key = crypto.randomUUID();
    await admin("insert into public.recipes (owner_id, title, idempotency_key) values ($1, 'A', $2)", [uid, key]);
    await expect(admin("insert into public.recipes (owner_id, title, idempotency_key) values ($1, 'A', $2)", [uid, key])).rejects.toMatchObject({ code: '23505' });
    // null keys never collide
    await admin("insert into public.recipes (owner_id, title) values ($1, 'B'), ($1, 'B')", [uid]);
  });

  it('simultaneous inserts get distinct positions', async () => {
    const call = (i: number) =>
      asUser(uid, (c) =>
        c.query("select public.insert_recipe_image($1, $2, $3, 'upload', null, null, '', 10, 10, 100) as id", [rid, `${uid}/${rid}/p${s}${i}.webp`, `${uid}/${rid}/p${s}${i}_t.webp`]),
      );
    await Promise.all(Array.from({ length: 8 }, (_, i) => call(i)));
    const rows = await admin('select position from public.recipe_images where recipe_id = $1 order by position', [rid]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('the quota holds under concurrency (returns null over the limit)', async () => {
    const call = (i: number) =>
      asUser(uid, (c) =>
        c.query("select public.insert_recipe_image($1, $2, $3, 'upload', null, null, '', 10, 10, 10) as id", [rid, `${uid}/${rid}/q${s}${i}.webp`, `${uid}/${rid}/q${s}${i}_t.webp`]),
      );
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i)));
    expect(res.filter((r) => r.rows[0].id === null).length).toBe(4); // 8 already stored, limit 10
    const [{ n }] = await admin('select count(*)::int as n from public.recipe_images where owner_id = $1', [uid]);
    expect(n).toBe(10);
  });
});
