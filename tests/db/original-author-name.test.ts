/** original_author_name derivato lato server (migration 20261025020000): il client non puo' falsificarlo. */
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
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
const mkUser = async (name: string) =>
  (await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id;
const authorName = async (rid: string) => (await admin<{ n: string | null }>('select original_author_name as n from public.recipes where id = $1', [rid]))[0].n;

d('db original_author_name server-side', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let alice: string, bob: string, carol: string;
  let src: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    alice = await mkUser(`oa_a_${s}`);
    bob = await mkUser(`oa_b_${s}`);
    carol = await mkUser(`oa_c_${s}`);
    src = (await as<{ id: string }>(alice, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Fonte', 'public') returning id", [alice]))[0].id;
  });
  afterAll(async () => pool?.end());

  const copy = (uid: string, from: string, author: string, fakeName: string) =>
    as<{ id: string }>(
      uid,
      "insert into public.recipes (owner_id, title, visibility, copied_from_recipe_id, original_author_id, original_author_name) values ($1, 'Copia', 'private', $2, $3, $4) returning id",
      [uid, from, author, fakeName],
    ).then((r) => r[0].id);

  it('without copied_from_recipe_id a client-supplied name is discarded', async () => {
    const [r] = await as<{ id: string }>(bob, "insert into public.recipes (owner_id, title, original_author_name) values ($1, 'Mia', 'Gualtiero Marchesi') returning id", [bob]);
    expect(await authorName(r.id)).toBeNull();
  });

  it('a copy gets @username of the source owner, not the spoofed name', async () => {
    const r = await copy(bob, src, alice, 'Chef Famoso');
    expect(await authorName(r)).toBe(`@oa_a_${s}`);
  });

  it('a copy of a copy keeps the original author', async () => {
    const first = await copy(bob, src, alice, 'x');
    await as(bob, "update public.recipes set visibility = 'public' where id = $1", [first]);
    const second = await copy(carol, first, alice, 'Bob il vero autore');
    expect(await authorName(second)).toBe(`@oa_a_${s}`);
  });

  it('the name cannot be changed after creation', async () => {
    const r = await copy(bob, src, alice, 'x');
    await as(bob, "update public.recipes set original_author_name = 'Altro', title = 'Copia 2' where id = $1", [r]);
    const [row] = await admin<{ n: string; t: string }>('select original_author_name as n, title as t from public.recipes where id = $1', [r]);
    expect(row).toEqual({ n: `@oa_a_${s}`, t: 'Copia 2' });
  });

  it('a spoofed original_author_id is rejected', async () => {
    await expect(copy(bob, src, carol, 'x')).rejects.toThrow();
  });
});
