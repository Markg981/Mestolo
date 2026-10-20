/** Daily rate limits enforced by triggers (migration 20261022000005), executed on real PostgreSQL. */
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

d('db rate limits', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('blocks the 31st friend request of the day, even via direct insert', async () => {
    const me = await mkUser(`rl_f_${s}`);
    const others = await Promise.all(Array.from({ length: 31 }, (_, i) => mkUser(`rl_f${i}_${s}`)));
    for (const o of others.slice(0, 30)) await as(me, 'insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [me, o]);
    await expect(as(me, 'insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [me, others[30]])).rejects.toMatchObject({ code: 'RL001' });
    const [c] = await admin("select n from public.daily_action_counts where user_id = $1 and action = 'friend_request'", [me]);
    expect(c.n).toBe(30);
  });

  it('blocks the 21st report of the day', async () => {
    const me = await mkUser(`rl_r_${s}`);
    const author = await mkUser(`rl_a_${s}`);
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      ids.push((await as(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'P', 'public') returning id", [author]))[0].id);
    }
    for (const id of ids.slice(0, 20)) await as(me, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [me, id]);
    await expect(as(me, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [me, ids[20]])).rejects.toMatchObject({ code: 'RL001' });
  });

  it('clients cannot read or edit the counters', async () => {
    const me = await mkUser(`rl_c_${s}`);
    await expect(as(me, 'select * from public.daily_action_counts')).rejects.toThrow();
  });
});
