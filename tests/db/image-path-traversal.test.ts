/** M-21: i path immagine con '..', '//', '\' o '/' iniziale sono rifiutati (migration 20261120000021). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

d('recipe_images path safe', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('rifiuta path non sicuri e accetta quelli normali', async () => {
    const [{ id: u }] = await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`pt_${s}@example.test`, JSON.stringify({ username: `pt_${s}` })]);
    const [{ id: r }] = await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'P', 'private') returning id", [u]);
    const ins = (p: string) => admin('insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3)', [r, u, p]);
    for (const bad of [`${u}/${r}/../other/x.webp`, `${u}/${r}//x.webp`, `${u}/${r}\\x.webp`, `/${u}/${r}/x.webp`]) {
      await expect(ins(bad)).rejects.toThrow(/recipe_images_path_safe/);
    }
    await expect(ins(`${u}/${r}/ok..name.webp`)).resolves.toBeDefined();
  });
});
