/** Recipe nutrition (migration 20261026000004): RLS follows recipe visibility, only the owner writes. */
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

d('recipe nutrition', () => {
  let owner: string, other: string, tag: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    tag = Math.random().toString(36).slice(2, 7);
    owner = await user(`nu_${tag}`);
    other = await user(`no_${tag}`);
  });
  afterAll(async () => pool?.end());

  const recipe = async (visibility: string, publicPage = false) =>
    (
      await as<{ id: string; public_slug: string | null }>(
        owner,
        'insert into public.recipes (owner_id, title, visibility, public_page_enabled, ingredients, steps) values ($1, $2, $3, $4, $5, $6) returning id, public_slug',
        [owner, 'Pasta', visibility, publicPage, JSON.stringify([{ name: 'pasta' }]), JSON.stringify([{ text: 'Cuoci' }])],
      )
    )[0];
  const put = (uid: string, id: string, source = 'manual') =>
    as(uid, 'insert into public.recipe_nutrition (recipe_id, energy_kcal, protein_g, source) values ($1, 300, 10, $2) returning recipe_id', [id, source]);

  it('owner writes, reads and updates; updated_at moves', async () => {
    const r = await recipe('private');
    await put(owner, r.id);
    await as(owner, "update public.recipe_nutrition set energy_kcal = 350, source = 'ai_estimate' where recipe_id = $1", [r.id]);
    const [row] = await as<{ energy_kcal: string; source: string }>(owner, 'select energy_kcal, source from public.recipe_nutrition where recipe_id = $1', [r.id]);
    expect(Number(row.energy_kcal)).toBe(350);
    expect(row.source).toBe('ai_estimate');
  });

  it('rejects invalid sources and inconsistent values', async () => {
    const r = await recipe('private');
    await expect(put(owner, r.id, 'guess')).rejects.toThrow();
    await expect(as(owner, 'insert into public.recipe_nutrition (recipe_id, carbs_g, sugars_g, source) values ($1, 5, 9, $2)', [r.id, 'manual'])).rejects.toThrow();
    await expect(as(owner, 'insert into public.recipe_nutrition (recipe_id, energy_kcal, source) values ($1, -1, $2)', [r.id, 'manual'])).rejects.toThrow();
  });

  it('only the owner can write, even on a public recipe', async () => {
    const r = await recipe('public');
    await expect(put(other, r.id)).rejects.toThrow(/row-level security/);
    await put(owner, r.id);
    expect(await as(other, "update public.recipe_nutrition set energy_kcal = 1 where recipe_id = $1 returning recipe_id", [r.id])).toHaveLength(0);
    expect(await as(other, 'delete from public.recipe_nutrition where recipe_id = $1 returning recipe_id', [r.id])).toHaveLength(0);
  });

  it('read follows recipe visibility', async () => {
    const priv = await recipe('private');
    const pub = await recipe('public');
    await put(owner, priv.id);
    await put(owner, pub.id);
    expect(await as(other, 'select 1 from public.recipe_nutrition where recipe_id = $1', [priv.id])).toHaveLength(0);
    expect(await as(other, 'select 1 from public.recipe_nutrition where recipe_id = $1', [pub.id])).toHaveLength(1);
    await expect(as(null, 'select 1 from public.recipe_nutrition')).rejects.toThrow(/permission denied/);
  });

  it('public function exposes values only for active public pages', async () => {
    const on = await recipe('public', true);
    const off = await recipe('public', false);
    const priv = await recipe('private', true);
    for (const r of [on, off, priv]) await put(owner, r.id);
    const rows = await as<{ energy_kcal: string; source: string }>(null, 'select * from public.get_public_recipe_nutrition($1)', [on.public_slug]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].energy_kcal)).toBe(300);
    expect(await as(null, 'select * from public.get_public_recipe_nutrition($1)', [off.public_slug])).toHaveLength(0);
    expect(await as(null, 'select * from public.get_public_recipe_nutrition($1)', [priv.public_slug])).toHaveLength(0);
  });

  it('is removed with the recipe', async () => {
    const r = await recipe('private');
    await put(owner, r.id);
    await as(owner, 'delete from public.recipes where id = $1', [r.id]);
    expect(await admin('select 1 from public.recipe_nutrition where recipe_id = $1', [r.id])).toHaveLength(0);
  });
});
