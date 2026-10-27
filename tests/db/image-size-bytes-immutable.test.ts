/** DB-02: size_bytes non e' modificabile da authenticated (migration 20261121000102). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

d('recipe_images size_bytes immutabile', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('authenticated non puo aggirare la quota con UPDATE size_bytes', async () => {
    const [{ id: u }] = await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`sb_${s}@example.test`, JSON.stringify({ username: `sb_${s}` })]);
    const [{ id: r }] = await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'S', 'private') returning id", [u]);
    const [{ id: i }] = await admin('insert into public.recipe_images (recipe_id, owner_id, storage_path, size_bytes) values ($1, $2, $3, 1000) returning id', [r, u, `${u}/${r}/a.webp`]);
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: 'authenticated' })]);
      await expect(c.query('update public.recipe_images set size_bytes = 0 where id = $1', [i])).rejects.toThrow(/size_bytes is immutable/);
    } finally {
      await c.query('rollback');
      c.release();
    }
    const [row] = await admin('select size_bytes from public.recipe_images where id = $1', [i]);
    expect(Number(row.size_bytes)).toBe(1000);
  });
});
