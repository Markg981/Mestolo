/** In-app feedback (migration 20261025014000): own insert/select, moderators read all and change status, anon denied. */
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
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

async function user(name: string) {
  const [r] = await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]);
  return r.id;
}

d('app feedback', () => {
  let u1: string, u2: string, mod: string;
  const ins = (uid: string, msg = 'Il timer non parte', kind = 'bug') =>
    as<{ id: string }>(uid, "insert into public.app_feedback (kind, message, platform) values ($1, $2, 'android') returning id", [kind, msg]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    [u1, u2, mod] = await Promise.all(['fa', 'fb', 'fm'].map((n) => user(`${n}_${s}`)));
    await admin('update public.profiles set is_moderator = true where id = $1', [mod]); // operator via SQL
  });
  afterAll(async () => pool?.end());

  it('user_id defaults to the caller and others cannot be impersonated', async () => {
    const [row] = await ins(u1);
    const [r] = await admin<{ user_id: string; status: string }>('select user_id, status from public.app_feedback where id = $1', [row.id]);
    expect(r.user_id).toBe(u1);
    expect(r.status).toBe('new');
    await expect(as(u1, "insert into public.app_feedback (user_id, kind, message) values ($1, 'idea', 'Fingo di essere un altro')", [u2])).rejects.toThrow(/permission denied|row-level security/);
  });

  it('validates kind, message length and platform', async () => {
    await expect(ins(u1, 'ok!')).rejects.toThrow(/check constraint/);
    await expect(ins(u1, 'x'.repeat(4001))).rejects.toThrow(/check constraint/);
    await expect(ins(u1, 'Messaggio valido', 'spam')).rejects.toThrow(/check constraint/);
    await expect(as(u1, "insert into public.app_feedback (kind, message, platform) values ('bug', 'Messaggio valido', 'windows')")).rejects.toThrow(/check constraint/);
    expect(await ins(u1, 'x'.repeat(4000))).toHaveLength(1);
  });

  it('users see only their own feedback, moderators see all', async () => {
    const [row] = await ins(u1, 'Idea: modalita scura');
    expect(await as(u1, 'select id from public.app_feedback where id = $1', [row.id])).toHaveLength(1);
    expect(await as(u2, 'select id from public.app_feedback where id = $1', [row.id])).toHaveLength(0);
    expect(await as(mod, 'select id from public.app_feedback where id = $1', [row.id])).toHaveLength(1);
  });

  it('only moderators change the status, and only the status', async () => {
    const [row] = await ins(u1, 'Bug nella lista spesa');
    await expect(as(u1, "update public.app_feedback set message = 'modificato' where id = $1", [row.id])).rejects.toThrow(/permission denied/);
    // the author has the column grant on status but no update policy: 0 rows touched
    expect(await as(u1, "update public.app_feedback set status = 'done' where id = $1 returning id", [row.id])).toHaveLength(0);
    expect(await as(mod, "update public.app_feedback set status = 'seen' where id = $1 returning id", [row.id])).toHaveLength(1);
    await expect(as(mod, "update public.app_feedback set message = 'modificato' where id = $1", [row.id])).rejects.toThrow(/permission denied/);
    const [r] = await admin<{ status: string }>('select status from public.app_feedback where id = $1', [row.id]);
    expect(r.status).toBe('seen');
    await expect(as(mod, "update public.app_feedback set status = 'archived' where id = $1", [row.id])).rejects.toThrow(/check constraint/);
  });

  it('users cannot delete feedback and anon has no access', async () => {
    const [row] = await ins(u1, 'Bug da non cancellare');
    await expect(as(u1, 'delete from public.app_feedback where id = $1', [row.id])).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select id from public.app_feedback')).rejects.toThrow(/permission denied/);
    await expect(as(null, "insert into public.app_feedback (kind, message) values ('bug', 'Da anonimo')")).rejects.toThrow(/permission denied/);
  });

  it('limits to 10 feedback per day', async () => {
    const u = await user(`fl_${Math.random().toString(36).slice(2, 7)}`);
    for (let i = 0; i < 10; i++) await ins(u, `Feedback numero ${i}`);
    await expect(ins(u, 'Feedback numero 11')).rejects.toThrow(/rate_limited/);
  });
});
