/** Moderation rules (migrations 20261021000001, 20261025023000), executed on real PostgreSQL. */
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

async function user(name: string) {
  const [r] = await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]);
  return r.id;
}

d('moderation', () => {
  let author: string, r1: string, r2: string, r3: string, mod: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    [author, r1, r2, r3, mod] = await Promise.all(['au', 'ra', 'rb', 'rc', 'mo'].map((n) => user(`${n}_${s}`)));
    await admin('update public.profiles set is_moderator = true where id = $1', [mod]); // operator via SQL
    // segnalatori affidabili ai fini dell'auto-hide: email confermata e account vecchio (anche l'autore, per il test sull'auto-segnalazione)
    await admin("update auth.users set email_confirmed_at = now(), created_at = now() - interval '30 days' where id = any($1::uuid[])", [[author, r1, r2, r3]]);
  });
  afterAll(async () => pool?.end());

  const publicRecipe = async () =>
    (await as<{ id: string }>(author, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pubblica', 'public') returning id", [author]))[0].id;

  it('users cannot make themselves moderators', async () => {
    // Since 20261025000006 the column is not even updatable by users (column privileges); the trigger remains as a second barrier
    await expect(as(r1, 'update public.profiles set is_moderator = true where id = $1', [r1])).rejects.toThrow(/permission denied/);
    const [p] = await admin<{ is_moderator: boolean }>('select is_moderator from public.profiles where id = $1', [r1]);
    expect(p.is_moderator).toBe(false);
    expect((await as<{ m: boolean }>(r1, 'select public.is_moderator() as m'))[0].m).toBe(false);
    expect((await as<{ m: boolean }>(mod, 'select public.is_moderator() as m'))[0].m).toBe(true);
  });

  it('only moderators see all reports and can act on them', async () => {
    const rid = await publicRecipe();
    const [rep] = await as<{ id: string }>(r1, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam') returning id", [r1, rid]);
    expect(await as(r2, 'select id from public.reports where id = $1', [rep.id])).toHaveLength(0);
    expect(await as(mod, 'select id from public.reports where id = $1', [rep.id])).toHaveLength(1);
    await expect(as(r2, "select public.moderate_report($1, 'hide')", [rep.id])).rejects.toThrow(/forbidden/);
    await expect(as(author, "select public.moderate_report($1, 'restore')", [rep.id])).rejects.toThrow(/forbidden/);
  });

  it('hide removes the recipe for everyone but the owner; restore brings it back', async () => {
    const rid = await publicRecipe();
    const [rep] = await as<{ id: string }>(r1, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'offensive') returning id", [r1, rid]);
    await as(mod, "select public.moderate_report($1, 'hide')", [rep.id]);
    expect(await as(r2, 'select id from public.recipes where id = $1', [rid])).toHaveLength(0);
    expect(await as(author, 'select id from public.recipes where id = $1', [rid])).toHaveLength(1);
    expect(await as(mod, 'select id from public.recipes where id = $1', [rid])).toHaveLength(1); // reported => visible to moderators
    const [st] = await admin<{ status: string }>('select status from public.reports where id = $1', [rep.id]);
    expect(st.status).toBe('reviewed');
    // the owner still cannot un-hide it
    await as(author, 'update public.recipes set is_hidden = false where id = $1', [rid]);
    expect((await admin<{ is_hidden: boolean }>('select is_hidden from public.recipes where id = $1', [rid]))[0].is_hidden).toBe(true);
    await as(mod, "select public.moderate_report($1, 'restore')", [rep.id]);
    expect(await as(r2, 'select id from public.recipes where id = $1', [rid])).toHaveLength(1);
  });

  it('moderation does not create a content version', async () => {
    const rid = await publicRecipe();
    const [rep] = await as<{ id: string }>(r1, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam') returning id", [r1, rid]);
    await as(mod, "select public.moderate_report($1, 'hide')", [rep.id]);
    expect(await admin('select 1 from public.recipe_versions where recipe_id = $1', [rid])).toHaveLength(1);
  });

  it('three reports from different users hide the recipe automatically', async () => {
    const rid = await publicRecipe();
    for (const u of [r1, r2]) await as(u, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [u, rid]);
    expect((await admin<{ is_hidden: boolean }>('select is_hidden from public.recipes where id = $1', [rid]))[0].is_hidden).toBe(false);
    await as(r3, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [r3, rid]);
    expect((await admin<{ is_hidden: boolean }>('select is_hidden from public.recipes where id = $1', [rid]))[0].is_hidden).toBe(true);
    expect(await as(r1, 'select id from public.recipes where id = $1', [rid])).toHaveLength(0);
  });

  it('reports from new/unconfirmed accounts and from the author do not count for the auto-hide', async () => {
    const rid = await publicRecipe();
    const s = Math.random().toString(36).slice(2, 7);
    const fresh = await Promise.all(['fa', 'fb', 'fc'].map((n) => user(`${n}_${s}`))); // email non confermata, account nuovo
    for (const u of fresh) await as(u, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [u, rid]);
    // la policy RLS impedisce già all'autore di segnalarsi: inserita bypassando RLS per verificare il trigger
    await admin("insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [author, rid]);
    expect((await admin<{ is_hidden: boolean }>('select is_hidden from public.recipes where id = $1', [rid]))[0].is_hidden).toBe(false);
    // le segnalazioni restano registrate per la revisione manuale
    expect(await admin("select 1 from public.reports where recipe_id = $1 and status = 'open'", [rid])).toHaveLength(4);
  });

  it('dismiss closes a single report without changing visibility', async () => {
    const rid = await publicRecipe();
    const [rep] = await as<{ id: string }>(r1, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'other') returning id", [r1, rid]);
    await as(mod, "select public.moderate_report($1, 'dismiss')", [rep.id]);
    expect((await admin<{ status: string }>('select status from public.reports where id = $1', [rep.id]))[0].status).toBe('dismissed');
    expect(await as(r2, 'select id from public.recipes where id = $1', [rid])).toHaveLength(1);
  });

  it('normal owner edits still work after the moderation triggers', async () => {
    const rid = await publicRecipe();
    await as(author, "update public.recipes set title = 'Nuovo titolo' where id = $1", [rid]);
    expect((await admin<{ title: string; version: number }>('select title, version from public.recipes where id = $1', [rid]))[0]).toEqual({ title: 'Nuovo titolo', version: 2 });
  });
});
