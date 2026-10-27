/** M-16: reports_insert accetta solo status 'open' (migrazione 20261108000016). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

async function as(uid: string, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
async function user(name: string): Promise<string> {
  const [r] = await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]);
  return r.id;
}

d('reports_insert status', () => {
  let author: string, reporter: string, recipe: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    author = await user(`rsa_${s}`);
    reporter = await user(`rsb_${s}`);
    const [r] = await admin(
      "insert into public.recipes (owner_id, title, visibility) values ($1, 'Ricetta M16', 'public') returning id",
      [author],
    );
    recipe = r.id;
  });
  afterAll(async () => {
    await admin('delete from auth.users where id = any($1)', [[author, reporter]]);
    await pool.end();
  });

  it("rifiuta status 'reviewed'", async () => {
    await expect(
      as(reporter, "insert into public.reports (recipe_id, reason, status) values ($1, 'spam', 'reviewed')", [recipe]),
    ).rejects.toThrow(/row-level security/);
  });

  it("accetta status 'open'", async () => {
    const rows = await as(reporter, "insert into public.reports (recipe_id, reason, status) values ($1, 'spam', 'open') returning status", [recipe]);
    expect(rows[0].status).toBe('open');
  });
});
