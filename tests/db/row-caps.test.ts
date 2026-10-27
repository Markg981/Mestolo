/** Tetti di righe (migration 20261106000043) su PostgreSQL reale: la riga cap+1 fallisce con 54000. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;

d('db row caps', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('meal_plan_entries: cap 20000 per utente', async () => {
    const u = await mkUser(`rc_m_${s}`);
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) select $1, current_date + (g % 300), 'dinner', 'x' from generate_series(1, 20000) g", [u]);
    await expect(admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, current_date, 'lunch', 'x')", [u])).rejects.toMatchObject({ code: '54000' });
  });

  it('recipes: cap 10000 per utente', async () => {
    const u = await mkUser(`rc_r_${s}`);
    await admin('alter table public.recipes disable trigger recipes_daily_limit');
    try {
      await admin("insert into public.recipes (owner_id, title) select $1, 'r' || g from generate_series(1, 10000) g", [u]);
    } finally {
      await admin('alter table public.recipes enable trigger recipes_daily_limit');
    }
    await expect(admin("insert into public.recipes (owner_id, title) values ($1, 'extra')", [u])).rejects.toMatchObject({ code: '54000' });
  });

  it('recipes: tetto giornaliero 500', async () => {
    const u = await mkUser(`rc_d_${s}`);
    await admin("insert into public.recipes (owner_id, title) select $1, 'r' || g from generate_series(1, 500) g", [u]);
    await expect(admin("insert into public.recipes (owner_id, title) values ($1, 'extra')", [u])).rejects.toMatchObject({ code: 'RL001' });
  });

  it('shopping_list_members: cap 50 per lista (conta per list_id)', async () => {
    const owner = await mkUser(`rc_s_${s}`);
    const list = (await admin("insert into public.shopping_lists (owner_id, name) values ($1, 'L') returning id", [owner]))[0].id as string;
    const users = await Promise.all(Array.from({ length: 51 }, (_, i) => mkUser(`rc_s${i}_${s}`)));
    for (const u of users.slice(0, 50)) await admin('insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [list, u]);
    await expect(admin('insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [list, users[50]])).rejects.toMatchObject({ code: '54000' });
  });
});
