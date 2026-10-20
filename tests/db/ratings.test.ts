/** Valutazioni delle ricette (migration 20261025000004), eseguite su PostgreSQL reale. */
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
const rate = (uid: string, rid: string, stars: number) =>
  as(uid, 'insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, $3)', [rid, uid, stars]);
const agg = async (rid: string) => (await admin('select rating_avg::float as avg, rating_count as n from public.recipes where id = $1', [rid]))[0] as { avg: number | null; n: number };

d('db recipe ratings', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let author: string;
  let pub: string;
  let priv: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    author = await mkUser(`rt_a_${s}`);
    pub = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pubblica', 'public') returning id", [author]))[0].id;
    priv = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Privata', 'private') returning id", [author]))[0].id;
  });
  afterAll(async () => pool?.end());

  it('blocks rating your own recipe', async () => {
    await expect(rate(author, pub, 5)).rejects.toMatchObject({ code: '42501' });
  });

  it('blocks rating a recipe you cannot see, and out-of-range stars', async () => {
    const u = await mkUser(`rt_p_${s}`);
    await expect(rate(u, priv, 4)).rejects.toMatchObject({ code: '42501' });
    await expect(rate(u, pub, 6)).rejects.toMatchObject({ code: '23514' });
    await expect(rate(u, pub, 0)).rejects.toMatchObject({ code: '23514' });
  });

  it('cannot rate on behalf of another user', async () => {
    const u = await mkUser(`rt_x_${s}`);
    const v = await mkUser(`rt_y_${s}`);
    await expect(as(u, 'insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, 3)', [pub, v])).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps aggregates correct on insert, update and delete', async () => {
    const r = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Agg', 'public') returning id", [author]))[0].id as string;
    expect(await agg(r)).toEqual({ avg: null, n: 0 });
    const [u1, u2, u3] = await Promise.all([mkUser(`rt_1_${s}`), mkUser(`rt_2_${s}`), mkUser(`rt_3_${s}`)]);
    await rate(u1, r, 5);
    await rate(u2, r, 4);
    await rate(u3, r, 3);
    expect(await agg(r)).toEqual({ avg: 4, n: 3 });
    await as(u3, 'update public.recipe_ratings set stars = 1 where recipe_id = $1 and user_id = $2', [r, u3]);
    expect(await agg(r)).toEqual({ avg: 3.33, n: 3 });
    await as(u1, 'delete from public.recipe_ratings where recipe_id = $1 and user_id = $2', [r, u1]);
    expect(await agg(r)).toEqual({ avg: 2.5, n: 2 });
    await as(u2, 'delete from public.recipe_ratings where recipe_id = $1 and user_id = $2', [r, u2]);
    await as(u3, 'delete from public.recipe_ratings where recipe_id = $1 and user_id = $2', [r, u3]);
    expect(await agg(r)).toEqual({ avg: null, n: 0 });
  });

  it('does not bump recipe updated_at when ratings change', async () => {
    const r = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Ts', 'public') returning id", [author]))[0].id as string;
    const before = (await admin('select updated_at from public.recipes where id = $1', [r]))[0].updated_at;
    await rate(await mkUser(`rt_ts_${s}`), r, 5);
    const after = (await admin('select updated_at from public.recipes where id = $1', [r]))[0].updated_at;
    expect(after).toEqual(before);
  });

  it('does not leak individual ratings to other users', async () => {
    const r = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Leak', 'public') returning id", [author]))[0].id as string;
    const u = await mkUser(`rt_l1_${s}`);
    const v = await mkUser(`rt_l2_${s}`);
    await rate(u, r, 2);
    expect(await as(v, 'select * from public.recipe_ratings where recipe_id = $1', [r])).toHaveLength(0);
    expect(await as(author, 'select * from public.recipe_ratings where recipe_id = $1', [r])).toHaveLength(0);
    expect(await as(u, 'select * from public.recipe_ratings where recipe_id = $1', [r])).toHaveLength(1);
    // le modifiche altrui non toccano la riga
    expect(await as(v, 'update public.recipe_ratings set stars = 5 where recipe_id = $1 returning 1', [r])).toHaveLength(0);
    expect(await as(v, 'delete from public.recipe_ratings where recipe_id = $1 returning 1', [r])).toHaveLength(0);
    expect((await admin('select stars from public.recipe_ratings where recipe_id = $1', [r]))[0].stars).toBe(2);
  });

  it('lets nobody write the aggregates by hand', async () => {
    const r = (await as(author, "insert into public.recipes (owner_id, title, visibility, rating_avg, rating_count) values ($1, 'Fake', 'public', 5, 99) returning id", [author]))[0].id as string;
    expect(await agg(r)).toEqual({ avg: null, n: 0 });
    await as(author, 'update public.recipes set rating_avg = 5, rating_count = 99, title = $2 where id = $1', [r, 'Fake2']);
    expect(await agg(r)).toEqual({ avg: null, n: 0 });
  });

  it('removes the rating from the aggregate when the rater is deleted', async () => {
    const r = (await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Del', 'public') returning id", [author]))[0].id as string;
    const u = await mkUser(`rt_d_${s}`);
    await rate(u, r, 4);
    expect((await agg(r)).n).toBe(1);
    await admin('delete from auth.users where id = $1', [u]);
    expect(await agg(r)).toEqual({ avg: null, n: 0 });
  });

  it('blocks the 201st new rating of the day but not changes to existing ones', async () => {
    const u = await mkUser(`rt_rl_${s}`);
    const recs: string[] = [];
    for (let i = 0; i < 201; i++) {
      recs.push((await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'R', 'public') returning id", [author]))[0].id);
    }
    for (const id of recs.slice(0, 200)) await rate(u, id, 3);
    await expect(rate(u, recs[200], 3)).rejects.toMatchObject({ code: 'RL001' });
    await as(u, 'update public.recipe_ratings set stars = 5 where recipe_id = $1 and user_id = $2', [recs[0], u]);
  }, 60000);
});
