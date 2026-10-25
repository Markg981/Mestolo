/**
 * Cancellazione account lato DB: eliminando auth.users non resta nessuna riga dell'utente in nessuna
 * tabella che lo referenzia (cascade o set null), e i dati altrui condivisi con lui restano intatti.
 * Le FK sono lette dal catalogo: una nuova tabella senza ON DELETE corretto fa fallire il test.
 */
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

type Fk = { tbl: string; col: string; action: 'c' | 'n' };

d('db account deletion', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let fks: Fk[];
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    fks = (await admin(`
      select c.conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass`)) as Fk[];
  });
  afterAll(async () => pool?.end());

  it('every foreign key to auth.users cascades or sets null', async () => {
    expect(fks.length).toBeGreaterThan(20);
    expect(fks.filter((f) => f.action !== 'c' && f.action !== 'n')).toEqual([]);
  });

  it('removes every row of the user and keeps what friends own', async () => {
    const gone = await mkUser(`ad_g_${s}`);
    const friend = await mkUser(`ad_f_${s}`);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [gone, friend]);

    // dati propri in buona parte delle tabelle dell'utente
    const rid = (await as(gone, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Mia', 'public') returning id", [gone]))[0].id;
    await admin("insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3)", [rid, gone, `${gone}/a.webp`]);
    await admin('insert into public.favorites (user_id, recipe_id) values ($1, $2)', [gone, rid]);
    await admin("insert into public.recipe_notes (recipe_id, owner_id, body) values ($1, $2, 'nota')", [rid, gone]);
    await admin("insert into public.meal_plan_entries (owner_id, recipe_id, plan_date, slot, title) values ($1, $2, current_date, 'dinner', 'Mia')", [gone, rid]);
    await admin("insert into public.pantry_items (owner_id, name) values ($1, 'sale')", [gone]);
    await admin("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'k')", [gone, `https://fcm.googleapis.com/fcm/send/ad-${s}`]);
    await admin("insert into public.cook_logs (user_id, recipe_id, photo_path) values ($1, $2, $3)", [gone, rid, `${gone}/cook/x.webp`]);
    await admin("insert into public.collections (owner_id, name) values ($1, 'mia')", [gone]);

    // dati dell'amico condivisi con l'utente che se ne va
    const fRecipe = (await as(friend, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Amico', 'public') returning id", [friend]))[0].id;
    await as(gone, 'insert into public.recipe_ratings (recipe_id, user_id, stars) values ($1, $2, 4)', [fRecipe, gone]);
    const copy = (await as(friend, 'insert into public.recipes (owner_id, title, copied_from_recipe_id, original_author_id) values ($1, $2, $3, $4) returning id', [friend, 'Copia', rid, gone]))[0].id;
    const lid = (await admin("insert into public.shopping_lists (owner_id, name) values ($1, 'spesa') returning id", [friend]))[0].id;
    await as(friend, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [lid, gone]);
    const cid = (await admin("insert into public.collections (owner_id, name) values ($1, 'comune') returning id", [friend]))[0].id;
    await as(friend, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'editor')", [cid, gone]);
    await admin("insert into public.shopping_items (list_id, owner_id, name, checked_by) values ($1, $2, 'pane', $3)", [lid, friend, gone]);

    await admin('delete from auth.users where id = $1', [gone]);

    const leftovers: string[] = [];
    for (const f of fks) {
      const [{ n }] = await admin(`select count(*)::int as n from ${f.tbl} where ${f.col} = $1`, [gone]);
      if (n > 0) leftovers.push(`${f.tbl}.${f.col}=${n}`);
    }
    expect(leftovers).toEqual([]);

    // l'amico conserva i propri dati; la copia resta ma senza riferimento all'autore cancellato
    expect(await admin('select 1 from public.recipes where id = any($1)', [[fRecipe, copy]])).toHaveLength(2);
    expect(await admin('select 1 from public.shopping_lists where id = $1', [lid])).toHaveLength(1);
    expect(await admin('select 1 from public.collections where id = $1', [cid])).toHaveLength(1);
    expect(await admin("select 1 from public.shopping_items where list_id = $1 and name = 'pane'", [lid])).toHaveLength(1);
    expect((await admin('select rating_count as n from public.recipes where id = $1', [fRecipe]))[0].n).toBe(0);
  });
});
