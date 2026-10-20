/**
 * are_friends / is_blocked_between must not leak the social graph to third
 * parties, while the RLS policies that rely on them keep working.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
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

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function createUser(username: string): Promise<string> {
  const rows = await admin<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${username}@example.test`, JSON.stringify({ username, locale: 'it' })],
  );
  return rows[0].id;
}

d('Social graph functions', () => {
  let a: string;
  let b: string;
  let c: string;
  let e: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    a = await createUser(`sga_${s}`);
    b = await createUser(`sgb_${s}`);
    c = await createUser(`sgc_${s}`);
    e = await createUser(`sge_${s}`);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [a, b]);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [a, e]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const friends = (uid: string | null, x: string, y: string) =>
    as<{ r: boolean }>(uid, 'select public.are_friends($1, $2) as r', [x, y]).then((rows) => rows[0].r);
  const blocked = (uid: string | null, x: string, y: string) =>
    as<{ r: boolean }>(uid, 'select public.is_blocked_between($1, $2) as r', [x, y]).then((rows) => rows[0].r);

  it('parties can query their own relationship', async () => {
    expect(await friends(a, a, b)).toBe(true);
    expect(await friends(b, a, b)).toBe(true);
    expect(await blocked(a, a, e)).toBe(true);
    expect(await blocked(e, a, e)).toBe(true);
  });

  it('a third user cannot probe the relationship between two others', async () => {
    expect(await friends(c, a, b)).toBe(false);
    expect(await blocked(c, a, e)).toBe(false);
  });

  it('anon cannot execute the functions', async () => {
    await expect(friends(null, a, b)).rejects.toThrow(/permission denied/);
    await expect(blocked(null, a, e)).rejects.toThrow(/permission denied/);
  });

  it('policies relying on the functions still work', async () => {
    const [{ id }] = await as<{ id: string }>(a, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Amici', 'friends') returning id", [a]);
    expect(await as(b, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
    expect(await as(c, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    const [{ id: pub }] = await as<{ id: string }>(a, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pubblica', 'public') returning id", [a]);
    expect(await as(c, 'select id from public.recipes where id = $1', [pub])).toHaveLength(1);
    expect(await as(e, 'select id from public.recipes where id = $1', [pub])).toHaveLength(0);
  });
});
