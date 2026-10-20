/** Rilevamento duplicati in SQL (migration 20261023000002), eseguito su PostgreSQL reale. */
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
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;
const mkRecipe = async (owner: string, title: string, sourceUrl: string | null = null, ingredients: string[] = []) =>
  (await admin('insert into public.recipes (owner_id, title, source_url, ingredients) values ($1, $2, $3, $4) returning id', [owner, title, sourceUrl, JSON.stringify(ingredients.map((name) => ({ name })))]))[0].id as string;
const find = (uid: string, title: string, src: string | null = null, ings: string[] = [], exclude: string | null = null) =>
  as(uid, 'select * from public.find_possible_duplicates($1, $2, $3, $4)', [title, src, ings, exclude]);

d('db duplicates', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('finds same source, similar title and similar content', async () => {
    const me = await mkUser(`dup_a_${s}`);
    const carb = await mkRecipe(me, 'Spaghetti alla carbonara', 'https://www.site.it/carbonara/?utm_source=x');
    const torta = await mkRecipe(me, 'Torta di mele', null, ['Mele', 'farina', 'zucchero', 'uova', 'burro']);
    await mkRecipe(me, 'Risotto ai funghi', null, ['riso']);

    const bySource = await find(me, 'Altro', 'http://site.it/carbonara');
    expect(bySource).toMatchObject([{ id: carb, reason: 'same_source', score: 1 }]);

    const byTitle = await find(me, 'spaghetti carbonara!');
    expect(byTitle).toMatchObject([{ id: carb, reason: 'similar_title' }]);

    const byContent = await find(me, 'Torta di mele soffice', null, ['Mele', 'farina', 'zucchero', 'uova', 'burro']);
    expect(byContent).toMatchObject([{ id: torta, reason: 'similar_content' }]);

    expect(await find(me, 'Insalata di pollo', null, ['patate'])).toEqual([]);
  });

  it('ignores other users recipes and the excluded id', async () => {
    const me = await mkUser(`dup_b_${s}`);
    const other = await mkUser(`dup_c_${s}`);
    await mkRecipe(other, 'Lasagne al forno', 'https://example.test/lasagne');
    expect(await find(me, 'Lasagne al forno', 'https://example.test/lasagne')).toEqual([]);
    const mine = await mkRecipe(me, 'Lasagne al forno');
    expect(await find(me, 'Lasagne al forno')).toMatchObject([{ id: mine, reason: 'similar_title', score: 1 }]);
    expect(await find(me, 'Lasagne al forno', null, [], mine)).toEqual([]);
  });

  it('normalizes accents, case, punctuation and stopwords', async () => {
    const me = await mkUser(`dup_d_${s}`);
    const id = await mkRecipe(me, 'Crème Brûlée');
    expect(await find(me, '  creme   BRULEE!! ')).toMatchObject([{ id, score: 1 }]);
    const r = await admin("select public.dup_normalize_text('  Café, già-Pronto!  ') as t, public.dup_normalize_url('https://WWW.Site.it/a/b/?utm_x=1&q=2&fbclid=z') as u");
    expect(r[0]).toEqual({ t: 'cafe gia pronto', u: 'site.it/a/b?q=2' });
  });
});
