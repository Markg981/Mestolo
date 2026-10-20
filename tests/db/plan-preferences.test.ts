/** plan_preferences (RLS solo proprietario) e move_plan_entry (migration 20261026000003), su PostgreSQL reale. */
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
const mkEntry = async (uid: string, date: string, slot: string, title: string) =>
  (await admin('insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, $2, $3, $4) returning id', [uid, date, slot, title]))[0].id as string;
const pos = async (id: string) => (await admin('select plan_date::text as d, slot::text as s from public.meal_plan_entries where id = $1', [id]))[0] as { d: string; s: string };

d('plan preferences e spostamento voci', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('le preferenze sono visibili e scrivibili solo dal proprietario', async () => {
    const a = await mkUser(`pp_a_${s}`);
    const b = await mkUser(`pp_b_${s}`);
    await as(a, "insert into public.plan_preferences (user_id, weekday_max_minutes, avoid_ingredients) values ($1, 30, '{noci}')", [a]);
    expect(await as(b, 'select user_id from public.plan_preferences')).toHaveLength(0);
    await expect(as(b, 'insert into public.plan_preferences (user_id) values ($1)', [a])).rejects.toThrow(/row-level security/);
    await as(b, 'update public.plan_preferences set weekday_max_minutes = 5');
    await as(b, 'delete from public.plan_preferences');
    const rows = await as<{ weekday_max_minutes: number; repeat_level: string }>(a, 'select weekday_max_minutes, repeat_level from public.plan_preferences');
    expect(rows).toEqual([{ weekday_max_minutes: 30, repeat_level: 'medium' }]);
  });

  it('rifiuta valori non validi', async () => {
    const a = await mkUser(`pp_c_${s}`);
    await expect(as(a, "insert into public.plan_preferences (user_id, days) values ($1, '{7}')", [a])).rejects.toThrow();
    await expect(as(a, "insert into public.plan_preferences (user_id, repeat_level) values ($1, 'x')", [a])).rejects.toThrow();
  });

  it('move_plan_entry sposta, scambia e azzera il promemoria inviato', async () => {
    const a = await mkUser(`pp_d_${s}`);
    const e1 = await mkEntry(a, '2026-11-02', 'lunch', 'Pasta');
    const e2 = await mkEntry(a, '2026-11-03', 'dinner', 'Pizza');
    await admin('insert into public.meal_reminders_sent (entry_id) values ($1)', [e1]);
    await as(a, 'select public.move_plan_entry($1, $2, $3)', [e1, '2026-11-04', 'dinner']);
    expect(await pos(e1)).toEqual({ d: '2026-11-04', s: 'dinner' });
    expect(await admin('select 1 from public.meal_reminders_sent where entry_id = $1', [e1])).toHaveLength(0);
    await as(a, 'select public.move_plan_entry($1, null, null, $2)', [e1, e2]);
    expect(await pos(e1)).toEqual({ d: '2026-11-03', s: 'dinner' });
    expect(await pos(e2)).toEqual({ d: '2026-11-04', s: 'dinner' });
  });

  it('move_plan_entry non tocca le voci di altri utenti', async () => {
    const a = await mkUser(`pp_e_${s}`);
    const b = await mkUser(`pp_f_${s}`);
    const ea = await mkEntry(a, '2026-11-02', 'lunch', 'A');
    const eb = await mkEntry(b, '2026-11-02', 'lunch', 'B');
    await expect(as(b, 'select public.move_plan_entry($1, $2, $3)', [ea, '2026-11-05', 'lunch'])).rejects.toThrow();
    await expect(as(b, 'select public.move_plan_entry($1, null, null, $2)', [eb, ea])).rejects.toThrow();
    expect(await pos(ea)).toEqual({ d: '2026-11-02', s: 'lunch' });
  });
});
