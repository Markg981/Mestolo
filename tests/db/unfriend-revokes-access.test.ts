/** A7: dopo la rimozione dell'amicizia, niente piu accesso a liste e raccolte condivise. */
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

d('db unfriend revokes shared access', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  async function setup(tag: string) {
    const o = await mkUser(`uf_o_${tag}_${s}`);
    const f = await mkUser(`uf_f_${tag}_${s}`);
    const fid = (await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted') returning id", [o, f]))[0].id as string;
    const lid = (await admin("insert into public.shopping_lists (owner_id, name) values ($1, 'l') returning id", [o]))[0].id as string;
    const cid = (await admin("insert into public.collections (owner_id, name) values ($1, 'c') returning id", [o]))[0].id as string;
    await as(o, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [lid, f]);
    await as(o, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'editor')", [cid, f]);
    return { o, f, fid, lid, cid };
  }
  const canList = async (u: string, lid: string) => (await as(u, 'select public.can_access_shopping_list($1) as ok', [lid]))[0].ok as boolean;
  const role = async (u: string, cid: string) => (await as(u, 'select public.collection_role($1) as r', [cid]))[0].r as string | null;

  it('delete friendship revokes list and collection access and removes member rows', async () => {
    const { o, f, fid, lid, cid } = await setup('del');
    expect(await canList(f, lid)).toBe(true);
    expect(await role(f, cid)).toBe('editor');
    await as(f, 'delete from public.friendships where id = $1', [fid]);
    expect(await canList(f, lid)).toBe(false);
    expect(await role(f, cid)).toBeNull();
    expect(await admin('select 1 from public.shopping_list_members where list_id = $1', [lid])).toHaveLength(0);
    expect(await admin('select 1 from public.collection_members where collection_id = $1', [cid])).toHaveLength(0);
    expect(await canList(o, lid)).toBe(true);
  });

  it('stale member rows grant nothing even if the trigger is bypassed', async () => {
    const { fid, f, lid, cid } = await setup('stale');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('delete from public.friendships where id = $1', [fid]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await admin('select 1 from public.shopping_list_members where list_id = $1', [lid])).toHaveLength(1);
    expect(await canList(f, lid)).toBe(false);
    expect(await role(f, cid)).toBeNull();
  });
});
