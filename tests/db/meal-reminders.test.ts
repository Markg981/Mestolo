/** Push subscriptions, notification preferences and due-meals query (migration 20261024000002), on real PostgreSQL. */
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
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name, locale: 'en' })]))[0].id as string;

const claim = async (now: string, window = 20) =>
  admin('select * from public.claim_due_meal_reminders($1::timestamptz, $2)', [now, window]) as Promise<{ entry_id: string; user_id: string; slot: string; title: string; locale: string }[]>;

d('meal plan notifications', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('push_subscriptions: users see and manage only their own rows', async () => {
    const a = await mkUser(`mr_a_${s}`);
    const b = await mkUser(`mr_b_${s}`);
    await as(a, 'select public.save_push_subscription($1, $2, $3, $4)', [`https://fcm.googleapis.com/fcm/send/a-${s}`, 'p', 'k', 'UA']);
    expect(await as(b, 'select id from public.push_subscriptions')).toHaveLength(0);
    await expect(as(b, "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://fcm.googleapis.com/fcm/send/x-' || $2, 'p', 'k')", [a, s])).rejects.toThrow(/row-level security/);
    await as(b, 'delete from public.push_subscriptions');
    expect(await as(a, 'select id from public.push_subscriptions')).toHaveLength(1);
    await as(b, "update public.push_subscriptions set auth = 'hacked'");
    expect((await as<{ auth: string }>(a, 'select auth from public.push_subscriptions'))[0].auth).toBe('k');
    await as(a, 'delete from public.push_subscriptions');
    expect(await as(a, 'select id from public.push_subscriptions')).toHaveLength(0);
  });

  it('save_push_subscription reassigns a shared endpoint to the current user and is idempotent', async () => {
    const a = await mkUser(`mr_c_${s}`);
    const b = await mkUser(`mr_d_${s}`);
    const ep = `https://fcm.googleapis.com/fcm/send/shared-${s}`;
    await as(a, 'select public.save_push_subscription($1, $2, $3, null)', [ep, 'p1', 'k1']);
    await as(a, 'select public.save_push_subscription($1, $2, $3, null)', [ep, 'p2', 'k2']);
    await as(b, 'select public.save_push_subscription($1, $2, $3, null)', [ep, 'p3', 'k3']);
    expect(await as(a, 'select id from public.push_subscriptions')).toHaveLength(0);
    expect((await as<{ p256dh: string }>(b, 'select p256dh from public.push_subscriptions'))[0].p256dh).toBe('p3');
  });

  it('notification_preferences: own rows only, invalid timezone rejected', async () => {
    const a = await mkUser(`mr_e_${s}`);
    const b = await mkUser(`mr_f_${s}`);
    await as(a, "insert into public.notification_preferences (enabled, timezone) values (true, 'America/New_York')");
    expect(await as(b, 'select * from public.notification_preferences')).toHaveLength(0);
    await expect(as(b, "insert into public.notification_preferences (user_id, enabled) values ($1, true)", [a])).rejects.toThrow(/row-level security/);
    await expect(as(b, "insert into public.notification_preferences (timezone) values ('Mars/Olympus')")).rejects.toThrow(/time zone/i);
  });

  it('claim_due_meal_reminders honours the local time window, opt-in, slot time and dedupes', async () => {
    const u = await mkUser(`mr_g_${s}`);
    // Rome in January is UTC+1: dinner 18:30 local = 17:30 UTC
    await admin("insert into public.notification_preferences (user_id, enabled, timezone, lunch_time, dinner_time) values ($1, true, 'Europe/Rome', '12:00', '18:30')", [u]);
    await admin("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'k')", [u, `https://fcm.googleapis.com/fcm/send/g-${s}`]);
    const [dinner] = await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-01-15', 'dinner', 'Risotto') returning id", [u]);
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-01-15', 'snack', 'Mela')", [u]); // snack_time null
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-01-16', 'dinner', 'Domani')", [u]);

    expect((await claim('2031-01-15T17:29:00Z')).filter((r) => r.user_id === u)).toHaveLength(0); // before
    expect((await claim('2031-01-15T17:55:00Z', 20)).filter((r) => r.user_id === u)).toHaveLength(0); // 25 min late: outside window
    const due = (await claim('2031-01-15T17:40:00Z')).filter((r) => r.user_id === u);
    expect(due).toEqual([{ entry_id: dinner.id, user_id: u, slot: 'dinner', title: 'Risotto', locale: 'en' }]);
    expect((await claim('2031-01-15T17:45:00Z')).filter((r) => r.user_id === u)).toHaveLength(0); // already sent
  });

  it('keeps a claimed reminder retryable until confirmed (lease, max 3 attempts) and never after confirmation', async () => {
    const u = await mkUser(`mr_k_${s}`);
    await admin("insert into public.notification_preferences (user_id, enabled, timezone, dinner_time) values ($1, true, 'UTC', '19:00')", [u]);
    await admin("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'k')", [u, `https://fcm.googleapis.com/fcm/send/k-${s}`]);
    const [e] = await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-03-01', 'dinner', 'Retry') returning id", [u]);
    const mine = async (now: string) => (await claim(now)).filter((r) => r.user_id === u);
    const expire = () => admin("update public.meal_reminders_sent set claimed_at = now() - interval '10 minutes' where entry_id = $1", [e.id]);

    expect(await mine('2031-03-01T19:02:00Z')).toHaveLength(1); // attempt 1
    expect(await mine('2031-03-01T19:03:00Z')).toHaveLength(0); // lease still held: no duplicate
    await expire();
    expect(await mine('2031-03-01T19:04:00Z')).toHaveLength(1); // not confirmed: retried (attempt 2)
    await admin('select public.confirm_meal_reminders($1::uuid[])', [[e.id]]);
    await expire();
    expect(await mine('2031-03-01T19:05:00Z')).toHaveLength(0); // confirmed: never again

    const [e2] = await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-03-02', 'dinner', 'Cap') returning id", [u]);
    for (let i = 0; i < 3; i++) {
      expect(await mine('2031-03-02T19:02:00Z')).toHaveLength(1);
      await admin("update public.meal_reminders_sent set claimed_at = now() - interval '10 minutes' where entry_id = $1", [e2.id]);
    }
    expect(await mine('2031-03-02T19:02:00Z')).toHaveLength(0); // max attempts reached
  });

  it('confirm_meal_reminders is not callable by authenticated users', async () => {
    const u = await mkUser(`mr_l_${s}`);
    await expect(as(u, "select public.confirm_meal_reminders('{}'::uuid[])")).rejects.toThrow(/permission denied/);
  });

  it('does not claim for opted-out users or users without subscriptions', async () => {
    const off = await mkUser(`mr_h_${s}`);
    const nosub = await mkUser(`mr_i_${s}`);
    for (const [u, enabled] of [[off, false], [nosub, true]] as const) {
      await admin("insert into public.notification_preferences (user_id, enabled, timezone, dinner_time) values ($1, $2, 'UTC', '19:00')", [u, enabled]);
      await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-02-01', 'dinner', 'X')", [u]);
    }
    await admin("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'k')", [off, `https://fcm.googleapis.com/fcm/send/h-${s}`]);
    const rows = await claim('2031-02-01T19:05:00Z');
    expect(rows.filter((r) => r.user_id === off || r.user_id === nosub)).toHaveLength(0);
  });

  it('claim_due_meal_reminders is not callable by authenticated users', async () => {
    const u = await mkUser(`mr_j_${s}`);
    await expect(as(u, 'select * from public.claim_due_meal_reminders()')).rejects.toThrow(/permission denied/);
  });
});
