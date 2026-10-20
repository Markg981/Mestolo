/** Bounded recipe version history (migration 20261023000003), executed on real PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

d('recipe versions limit', () => {
  let owner: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    owner = (await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`vo_${s}@example.test`, JSON.stringify({ username: `vo_${s}` })]))[0].id;
  });
  afterAll(async () => pool?.end());

  const newRecipe = async () =>
    (await admin<{ id: string }>("insert into public.recipes (owner_id, title, visibility) values ($1, 'T0', 'public') returning id", [owner]))[0].id;
  const versions = async (id: string) =>
    (await admin<{ version: number }>('select version from public.recipe_versions where recipe_id = $1 order by version', [id])).map((r) => r.version);

  it('keeps exactly the newest N versions', async () => {
    const [{ n }] = await admin<{ n: number }>('select public.recipe_versions_limit() as n');
    const id = await newRecipe();
    for (let i = 1; i <= n + 5; i++) await admin('update public.recipes set title = $2 where id = $1', [id, `T${i}`]);
    const v = await versions(id);
    expect(v).toHaveLength(n);
    expect(v[0]).toBe(7);
    expect(v[v.length - 1]).toBe(n + 6);
  });

  it('does not create a version for no-op edits', async () => {
    const id = await newRecipe();
    await admin("update public.recipes set title = 'T0' where id = $1", [id]);
    expect(await versions(id)).toEqual([1]);
    await admin("update public.recipes set title = 'T1' where id = $1", [id]);
    expect(await versions(id)).toEqual([1, 2]);
  });
});
