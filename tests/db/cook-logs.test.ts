/** cook_logs: RLS, privacy, immutability, photo visibility and the daily limit (migration 20261025000003), on real PostgreSQL. */
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
const mkRecipe = async (owner: string, visibility: string) =>
  (await as(owner, 'insert into public.recipes (owner_id, title, visibility) values ($1, $2, $3) returning id', [owner, 'R', visibility]))[0].id as string;
const log = async (uid: string, rid: string, visibility = 'recipe', extra = '') =>
  (await as(uid, `insert into public.cook_logs (user_id, recipe_id, visibility, note ${extra ? ', photo_path' : ''}) values ($1, $2, $3, 'ottima' ${extra ? ', $4' : ''}) returning id`, extra ? [uid, rid, visibility, extra] : [uid, rid, visibility]))[0].id as string;
const count = async (uid: string, id: string) => (await as(uid, 'select id from public.cook_logs where id = $1', [id])).length;

d('db cook_logs', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('public recipe: others see the log unless the author keeps it private', async () => {
    const owner = await mkUser(`cl_o_${s}`);
    const cook = await mkUser(`cl_c_${s}`);
    const other = await mkUser(`cl_x_${s}`);
    const rid = await mkRecipe(owner, 'public');
    const shared = await log(cook, rid, 'recipe');
    const priv = await log(cook, rid, 'private');
    expect(await count(other, shared)).toBe(1);
    expect(await count(owner, shared)).toBe(1);
    expect(await count(other, priv)).toBe(0);
    expect(await count(owner, priv)).toBe(0);
    expect(await count(cook, priv)).toBe(1);
  });

  it('never broadens recipe visibility: private recipe, hidden recipe and blocked users', async () => {
    const owner = await mkUser(`cl_po_${s}`);
    const cook = await mkUser(`cl_pc_${s}`);
    const other = await mkUser(`cl_px_${s}`);
    const rid = await mkRecipe(owner, 'private');
    // chi non puo' leggere la ricetta non puo' nemmeno registrarla
    await expect(log(cook, rid)).rejects.toThrow();
    const own = await log(owner, rid);
    expect(await count(other, own)).toBe(0);

    const pub = await mkRecipe(owner, 'public');
    const l = await log(cook, pub);
    expect(await count(other, l)).toBe(1);
    await admin('update public.recipes set is_hidden = true where id = $1', [pub]);
    expect(await count(other, l)).toBe(0);
    expect(await count(cook, l)).toBe(1);
    await admin('update public.recipes set is_hidden = false where id = $1', [pub]);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [cook, other]);
    expect(await count(other, l)).toBe(0);
  });

  it('only the author edits; recipe, user and photo are immutable; the recipe owner can delete', async () => {
    const owner = await mkUser(`cl_eo_${s}`);
    const cook = await mkUser(`cl_ec_${s}`);
    const other = await mkUser(`cl_ex_${s}`);
    const rid = await mkRecipe(owner, 'public');
    const rid2 = await mkRecipe(owner, 'public');
    const id = await log(cook, rid);
    expect(await as(other, "update public.cook_logs set note = 'x' where id = $1 returning id", [id])).toHaveLength(0);
    expect(await as(cook, "update public.cook_logs set note = 'ok' where id = $1 returning id", [id])).toHaveLength(1);
    await expect(as(cook, 'update public.cook_logs set recipe_id = $2 where id = $1', [id, rid2])).rejects.toThrow();
    await expect(as(cook, "update public.cook_logs set photo_path = $2 where id = $1", [id, `${cook}/cook/a.webp`])).rejects.toThrow();
    await expect(as(cook, 'insert into public.cook_logs (user_id, recipe_id) values ($1, $2)', [other, rid])).rejects.toThrow();
    expect(await as(other, 'delete from public.cook_logs where id = $1 returning id', [id])).toHaveLength(0);
    expect(await as(owner, 'delete from public.cook_logs where id = $1 returning id', [id])).toHaveLength(1);
  });

  it('validates note length and photo path ownership', async () => {
    const cook = await mkUser(`cl_v_${s}`);
    const rid = await mkRecipe(cook, 'private');
    await expect(as(cook, 'insert into public.cook_logs (user_id, recipe_id, note) values ($1, $2, $3)', [cook, rid, 'x'.repeat(1001)])).rejects.toThrow();
    await expect(log(cook, rid, 'recipe', `${cook}/other/a.webp`)).rejects.toThrow();
    await expect(log(cook, rid, 'recipe', `00000000-0000-0000-0000-000000000000/cook/a.webp`)).rejects.toThrow();
    await expect(as(cook, "insert into public.cook_logs (user_id, recipe_id, visibility) values ($1, $2, 'friends')", [cook, rid])).rejects.toThrow();
    await log(cook, rid, 'recipe', `${cook}/cook/a.webp`);
  });

  it('photos follow the log visibility', async () => {
    const owner = await mkUser(`cl_so_${s}`);
    const cook = await mkUser(`cl_sc_${s}`);
    const other = await mkUser(`cl_sx_${s}`);
    const rid = await mkRecipe(owner, 'public');
    const p1 = `${cook}/cook/${s}-1.webp`;
    const p2 = `${cook}/cook/${s}-2.webp`;
    for (const p of [p1, p2]) await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [p, cook]);
    await log(cook, rid, 'recipe', p1);
    await log(cook, rid, 'private', p2);
    const read = (uid: string, p: string) => as(uid, 'select name from storage.objects where name = $1', [p]);
    expect(await read(other, p1)).toHaveLength(1);
    expect(await read(other, p2)).toHaveLength(0);
    expect(await read(cook, p2)).toHaveLength(1);
  });

  it('blocks the 31st log of the day, even via direct insert', async () => {
    const me = await mkUser(`cl_rl_${s}`);
    const rid = await mkRecipe(me, 'private');
    for (let i = 0; i < 30; i++) await log(me, rid);
    await expect(log(me, rid)).rejects.toMatchObject({ code: 'RL001' });
    const [c] = await admin("select n from public.daily_action_counts where user_id = $1 and action = 'cook_log'", [me]);
    expect(c.n).toBe(30);
  });
});

d('db cook_logs quota (insert_cook_log)', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('conta i byte delle foto e rifiuta oltre il tetto, in modo atomico', async () => {
    const u = await mkUser(`cl_q_${s}`);
    const rid = await mkRecipe(u, 'private');
    const call = (n: number, bytes: number, max: number) =>
      as(u, 'select public.insert_cook_log($1, now(), $2, $3, $4, $5, 2000, $6) as id', [rid, 'x', 'private', `${u}/cook/${n}-${s}.webp`, bytes, max]);
    expect((await call(1, 600, 1000))[0].id).not.toBeNull();
    expect((await call(2, 600, 1000))[0].id).toBeNull();
    expect((await call(3, 400, 1000))[0].id).not.toBeNull();
    // chiamate concorrenti: al massimo una entra
    const u2 = await mkUser(`cl_q2_${s}`);
    const rid2 = await mkRecipe(u2, 'private');
    const res = await Promise.all([1, 2, 3, 4].map((n) =>
      as(u2, 'select public.insert_cook_log($1, now(), $2, $3, $4, $5, 2000, $6) as id', [rid2, 'x', 'private', `${u2}/cook/${n}-${s}.webp`, 600, 1000])));
    expect(res.filter((r) => r[0].id !== null)).toHaveLength(1);
  });
});
