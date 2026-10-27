/** add_shopping_quantities e replace_plan_entries (migration 20261025201100) su PostgreSQL reale. */
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

d('lista della spesa e piano: operazioni atomiche', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  async function mkItem(uid: string, name: string, quantity: number | null, checked = false) {
    const list = (await admin("insert into public.shopping_lists (owner_id, name) values ($1, 'default') returning id", [uid]))[0].id as string;
    const id = (await admin('insert into public.shopping_items (list_id, owner_id, name, quantity, checked) values ($1, $2, $3, $4, $5) returning id', [list, uid, name, quantity, checked]))[0].id as string;
    return id;
  }
  const qty = async (id: string) => Number((await admin('select quantity from public.shopping_items where id = $1', [id]))[0].quantity);

  it('incrementi concorrenti sulla stessa voce non si perdono', async () => {
    const a = await mkUser(`sp_a_${s}`);
    const id = await mkItem(a, 'farina', 100);
    const bump = () => as(a, 'select public.add_shopping_quantities($1::jsonb) as n', [JSON.stringify([{ id, delta: 50 }])]);
    const res = await Promise.all(Array.from({ length: 10 }, bump));
    expect(res.every((r) => r[0].n === 1)).toBe(true);
    expect(await qty(id)).toBe(600);
  });

  it('non tocca voci spuntate, senza quantita o di altri utenti', async () => {
    const a = await mkUser(`sp_b_${s}`);
    const b = await mkUser(`sp_c_${s}`);
    const checked = await mkItem(a, 'latte', 1, true);
    const none = await mkItem(a, 'sale', null);
    const mine = await mkItem(a, 'olio', 2);
    const rows = await as<{ n: number }>(b, 'select public.add_shopping_quantities($1::jsonb) as n', [JSON.stringify([{ id: mine, delta: 5 }])]);
    expect(rows[0].n).toBe(0);
    const ok = await as<{ n: number }>(a, 'select public.add_shopping_quantities($1::jsonb) as n', [JSON.stringify([{ id: checked, delta: 1 }, { id: none, delta: 1 }, { id: mine, delta: 1 }])]);
    expect(ok[0].n).toBe(1);
    expect(await qty(mine)).toBe(3);
    expect(await qty(checked)).toBe(1);
  });

  it('rifiuta delta negativi, zero, nulli o enormi (A-13)', async () => {
    const a = await mkUser(`sp_q_${s}`);
    const id = await mkItem(a, 'zucchero', 10);
    for (const item of [{ id, delta: -5 }, { id, delta: 0 }, { id, delta: 1e12 }, { id }]) {
      await expect(as(a, 'select public.add_shopping_quantities($1::jsonb) as n', [JSON.stringify([item])])).rejects.toMatchObject({ code: '22023' });
    }
    expect(await qty(id)).toBe(10);
    const ok = await as<{ n: number }>(a, 'select public.add_shopping_quantities($1::jsonb) as n', [JSON.stringify([{ id, delta: 2 }])]);
    expect(ok[0].n).toBe(1);
  });

  it('replace_plan_entries sostituisce le celle indicate', async () => {
    const a = await mkUser(`sp_d_${s}`);
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2026-11-02', 'lunch', 'Vecchio'), ($1, '2026-11-02', 'dinner', 'Resta')", [a]);
    const rows = JSON.stringify([{ plan_date: '2026-11-02', slot: 'lunch', recipe_id: null, title: 'Nuovo', servings: 2 }]);
    expect((await as<{ n: number }>(a, 'select public.replace_plan_entries($1::jsonb) as n', [rows]))[0].n).toBe(1);
    const t = await admin("select title from public.meal_plan_entries where owner_id = $1 order by slot", [a]);
    // meal_slot enum order: lunch before dinner
    expect(t.map((r) => r.title)).toEqual(['Nuovo', 'Resta']);
  });

  it('replace_plan_entries e atomico: se l inserimento fallisce, le voci vecchie restano', async () => {
    const a = await mkUser(`sp_e_${s}`);
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2026-11-03', 'lunch', 'Intatto')", [a]);
    const bad = JSON.stringify([{ plan_date: '2026-11-03', slot: 'lunch', recipe_id: null, title: '', servings: 2 }]); // titolo vuoto: viola il check
    await expect(as(a, 'select public.replace_plan_entries($1::jsonb)', [bad])).rejects.toThrow();
    const t = await admin('select title from public.meal_plan_entries where owner_id = $1', [a]);
    expect(t.map((r) => r.title)).toEqual(['Intatto']);
  });

  it('replace_plan_entries non tocca le voci di altri utenti', async () => {
    const a = await mkUser(`sp_f_${s}`);
    const b = await mkUser(`sp_g_${s}`);
    await admin("insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2026-11-04', 'lunch', 'Di A')", [a]);
    const rows = JSON.stringify([{ plan_date: '2026-11-04', slot: 'lunch', recipe_id: null, title: 'Di B', servings: null }]);
    await as(b, 'select public.replace_plan_entries($1::jsonb)', [rows]);
    expect((await admin('select title from public.meal_plan_entries where owner_id = $1', [a])).map((r) => r.title)).toEqual(['Di A']);
  });
});
