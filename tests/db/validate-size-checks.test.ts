/** B-09: i CHECK di dimensione su recipes sono validati (migration 20261121000115). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

d('recipes size CHECK validati', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('i tre vincoli esistono e sono convalidati (DB di test senza righe oltre soglia)', async () => {
    const { rows } = await pool.query(
      "select conname, convalidated from pg_constraint where conrelid = 'public.recipes'::regclass and conname in ('recipes_ingredients_size_chk','recipes_steps_size_chk','recipes_field_flags_size_chk')",
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.convalidated).toBe(true);
  });
});
