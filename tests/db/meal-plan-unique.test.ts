/** Unicita (owner, data, slot, ricetta) su meal_plan_entries, su PostgreSQL reale. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

d('meal_plan_entries unicita per ricetta nello slot', () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: url }); });
  afterAll(async () => { await pool.end(); });

  it('rifiuta la stessa ricetta due volte, ammette ricette diverse e voci libere', async () => {
    const uid = (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', ['mpu@example.test', JSON.stringify({ username: 'mpu', locale: 'en' })]))[0].id as string;
    const rec = async (t: string) => (await admin('insert into public.recipes (owner_id, title) values ($1, $2) returning id', [uid, t]))[0].id as string;
    const [r1, r2] = [await rec('A'), await rec('B')];
    const ins = (r: string | null, t: string) => admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, recipe_id, title) values ($1, '2026-10-28', 'lunch', $2, $3)", [uid, r, t]);
    await ins(r1, 'A');
    await ins(r2, 'B');
    await ins(null, 'libera');
    await ins(null, 'libera');
    await expect(ins(r1, 'A')).rejects.toMatchObject({ code: '23505' });
  });
});
