/** Allowlist degli endpoint push (migration 20261025022000): niente SSRF verso host arbitrari. */
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

d('db push endpoint allowlist', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let u: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    u = await mkUser(`pe_${s}`);
  });
  afterAll(async () => pool?.end());

  const sub = (endpoint: string) =>
    as(u, "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'k') returning id", [u, endpoint]);

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-db5p.notify.windows.com/w/?token=abc',
  ])('accepts %s', async (endpoint) => {
    expect(await sub(`${endpoint}${s}`)).toHaveLength(1);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://evil.example/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/x',
    'https://fcm.googleapis.com@evil.example/x',
    'https://fcm.googleapis.com:8080/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://push.apple.com.evil.example/x',
    'https://evil.example/?u=https://fcm.googleapis.com/',
  ])('rejects %s', async (endpoint) => {
    await expect(sub(`${endpoint}${s}`)).rejects.toMatchObject({ code: '23514' });
  });

  it('an existing subscription cannot be moved to a foreign host', async () => {
    const [row] = await sub(`https://fcm.googleapis.com/fcm/send/mv-${s}`);
    await expect(as(u, "update public.push_subscriptions set endpoint = 'https://evil.example/x' where id = $1", [row.id])).rejects.toMatchObject({ code: '23514' });
  });
});
