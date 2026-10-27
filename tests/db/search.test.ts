/**
 * search_recipes: full-text (accent-insensitive, prefix) + trigram search on titles,
 * with RLS still deciding visibility and keyset/offset pagination.
 */
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

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function createUser(username: string): Promise<string> {
  const rows = await admin<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${username}@example.test`, JSON.stringify({ username, locale: 'it' })],
  );
  return rows[0].id;
}

d('search_recipes', () => {
  let a: string;
  let b: string;
  const s = Math.random().toString(36).slice(2, 7);
  const word = `zq${s}`;

  const search = (uid: string | null, q: string | null, extra = '') =>
    as<{ title: string; id: string }>(uid, `select id, title from public.search_recipes(p_query => $1${extra})`, [q]);

  const add = (owner: string, title: string, visibility: string, ingredients: unknown[] = [], tags: string[] = []) =>
    admin<{ id: string }>(
      'insert into public.recipes (owner_id, title, visibility, ingredients, tags) values ($1, $2, $3, $4, $5) returning id',
      [owner, title, visibility, JSON.stringify(ingredients), tags],
    ).then((r) => r[0].id);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    a = await createUser(`sra_${s}`);
    b = await createUser(`srb_${s}`);
    await add(a, `Crème brûlée ${word}`, 'private');
    await add(a, `Torta ${word}`, 'public', [{ name: 'Farina di mandorle' }], ['dolce']);
    await add(b, `Segreta ${word}`, 'private');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('matches ignoring accents and case', async () => {
    const rows = await search(a, `CREME brulee ${word}`);
    expect(rows.map((r) => r.title)).toEqual([`Crème brûlée ${word}`]);
  });

  it('matches prefixes, ingredients and tags', async () => {
    expect((await search(a, `tor ${word}`)).length).toBe(1);
    expect((await search(a, `${word} mandorle`)).length).toBe(1);
    expect((await search(a, `${word} dolce`)).length).toBe(1);
  });

  it('tolerates typos in the title (trigram)', async () => {
    const rows = await search(a, `Crem brulee ${word.slice(0, -1)}`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('respects RLS visibility', async () => {
    const asA = (await search(a, word)).map((r) => r.title);
    expect(asA).not.toContain(`Segreta ${word}`);
    expect(asA).toHaveLength(2);
    const asB = (await search(b, word)).map((r) => r.title);
    expect(asB).toContain(`Torta ${word}`);
    expect(asB).toContain(`Segreta ${word}`);
    expect(asB).not.toContain(`Crème brûlée ${word}`);
  });

  it('anon cannot call the function', async () => {
    await expect(search(null, word)).rejects.toThrow(/permission denied/);
  });

  it('paginates with offset and keyset cursor', async () => {
    const first = await search(a, word, ', p_limit => 1');
    expect(first).toHaveLength(1);
    const second = await search(a, word, ', p_limit => 1, p_offset => 1');
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    const [{ created_at }] = await admin<{ created_at: string }>('select created_at from public.recipes where id = $1', [first[0].id]);
    const after = await as<{ id: string }>(
      a,
      'select id from public.search_recipes(p_query => $1, p_after_created_at => $2, p_after_id => $3)',
      [word, created_at, first[0].id],
    );
    expect(after.map((r) => r.id)).toEqual([second[0].id]);
  });

  it('keeps the tsvector in sync on update', async () => {
    const id = await add(a, `Vecchio ${word}`, 'private');
    await admin("update public.recipes set title = $2 where id = $1", [id, `Nuovo ${word}`]);
    expect((await search(a, `nuovo ${word}`)).length).toBe(1);
    expect((await search(a, "vecchio")).length).toBe(0);
  });
});

d('search_profiles', () => {
  let viewer: string;
  const s = Math.random().toString(36).slice(2, 7);

  const find = (q: string) =>
    as<{ display_name: string }>(viewer, 'select display_name from public.search_profiles($1)', [q]);

  const mk = async (username: string, displayName: string) => {
    const id = await createUser(username);
    await admin('update public.profiles set discoverable = true, display_name = $2 where id = $1', [id, displayName]);
    return id;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    viewer = await mk(`spv_${s}`, `Viewer ${s}`);
    await mk(`sp1_${s}`, `a_b${s}`);
    await mk(`sp2_${s}`, `axb${s}`);
    await mk(`sp3_${s}`, `a%b${s}`);
    await mk(`sp4_${s}`, `a\\b${s}`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('treats _ as a literal: "a_b" does not match "axb"', async () => {
    expect((await find(`a_b${s}`)).map((r) => r.display_name)).toEqual([`a_b${s}`]);
  });

  it('treats % as a literal', async () => {
    expect((await find(`a%b${s}`)).map((r) => r.display_name)).toEqual([`a%b${s}`]);
  });

  it('treats \\ as a literal', async () => {
    expect((await find(`a\\b${s}`)).map((r) => r.display_name)).toEqual([`a\\b${s}`]);
  });
});
