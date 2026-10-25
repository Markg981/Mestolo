/**
 * Voti concorrenti sulla stessa ricetta (migrations 20261029000017, 20261031000001):
 * gli aggregati restano esatti e i voti simultanei non vanno in deadlock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;
const agg = async (rid: string) => (await admin('select rating_avg::float as avg, rating_count as n from public.recipes where id = $1', [rid]))[0] as { avg: number | null; n: number };

/** Apre una transazione come `uid` e la lascia aperta: commit/rollback li decide il test. */
async function open(uid: string) {
  const c = await pool.connect();
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
  return c;
}

d('db recipe ratings under concurrency', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let author: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    author = await mkUser(`rc_a_${s}`);
  });
  afterAll(async () => pool?.end());
  const recipe = async () => (await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'C', 'public') returning id", [author]))[0].id as string;

  it('the second vote waits for the first and counts both', async () => {
    const r = await recipe();
    const [u1, u2] = [await mkUser(`rc_1_${s}`), await mkUser(`rc_2_${s}`)];
    const c1 = await open(u1);
    const c2 = await open(u2);
    try {
      await c1.query('insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, 5)', [r, u1]);
      // c2 si blocca sul FOR UPDATE della ricetta finche' c1 non fa commit
      const pending = c2.query('insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, 2)', [r, u2]);
      let settled = false;
      void pending.finally(() => (settled = true));
      await new Promise((res) => setTimeout(res, 300));
      expect(settled).toBe(false);
      await c1.query('commit');
      await pending;
      await c2.query('commit');
    } finally {
      c1.release();
      c2.release();
    }
    expect(await agg(r)).toEqual({ avg: 3.5, n: 2 });
  });

  it('many simultaneous votes, updates and deletes leave exact aggregates', async () => {
    const r = await recipe();
    const users = await Promise.all(Array.from({ length: 20 }, (_, i) => mkUser(`rc_m${i}_${s}`)));
    const vote = async (uid: string, stars: number) => {
      const c = await open(uid);
      try {
        await c.query('insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, $3)', [r, uid, stars]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
    };
    await Promise.all(users.map((u, i) => vote(u, (i % 5) + 1)));
    expect(await agg(r)).toEqual({ avg: 3, n: 20 });

    const change = async (uid: string, sql: string) => {
      const c = await open(uid);
      try {
        await c.query(sql, [r, uid]);
        await c.query('commit');
      } finally {
        c.release();
      }
    };
    await Promise.all([
      ...users.slice(0, 5).map((u) => change(u, 'delete from public.recipe_ratings where recipe_id = $1 and user_id = $2')),
      ...users.slice(5, 10).map((u) => change(u, 'update public.recipe_ratings set stars = 5 where recipe_id = $1 and user_id = $2')),
    ]);
    const [expected] = await admin('select count(*)::int as n, round(avg(stars)::numeric, 2)::float as avg from public.recipe_ratings where recipe_id = $1', [r]);
    expect(expected.n).toBe(15);
    expect(await agg(r)).toEqual({ avg: expected.avg, n: 15 });
  });
});
