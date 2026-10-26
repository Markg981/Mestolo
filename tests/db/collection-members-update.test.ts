/** UPDATE dei membri di una raccolta (migration 20261025024000): solo il ruolo e' modificabile. */
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

d('db collection members update', () => {
  const s = Math.random().toString(36).slice(2, 7);
  let owner: string, friend: string, stranger: string, blocked: string;
  let col: string, other: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    owner = await mkUser(`cmu_o_${s}`);
    friend = await mkUser(`cmu_f_${s}`);
    stranger = await mkUser(`cmu_s_${s}`);
    blocked = await mkUser(`cmu_b_${s}`);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [owner, friend]);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [blocked, owner]);
    col = (await admin("insert into public.collections (owner_id, name) values ($1, 'c') returning id", [owner]))[0].id;
    other = (await admin("insert into public.collections (owner_id, name) values ($1, 'altra') returning id", [stranger]))[0].id;
    await as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [col, friend]);
  });
  afterAll(async () => pool?.end());

  const member = async () => (await admin('select user_id, role, invited_by, collection_id from public.collection_members where collection_id = $1', [col]))[0];

  it('the owner can change the role', async () => {
    await as(owner, "update public.collection_members set role = 'editor' where collection_id = $1 and user_id = $2", [col, friend]);
    expect((await member()).role).toBe('editor');
  });

  it.each([
    ['user_id → a stranger (no friendship)', 'user_id', () => stranger],
    ['user_id → someone who blocked the owner', 'user_id', () => blocked],
    ['invited_by → someone else', 'invited_by', () => stranger],
  ])('rejects swapping %s', async (_label, col_, value) => {
    await expect(as(owner, `update public.collection_members set ${col_} = $3 where collection_id = $1 and user_id = $2`, [col, friend, value()])).rejects.toMatchObject({ code: '42501' });
    expect(await member()).toMatchObject({ user_id: friend, invited_by: owner });
  });

  it('rejects moving the member into another collection', async () => {
    await expect(as(owner, 'update public.collection_members set collection_id = $3 where collection_id = $1 and user_id = $2', [col, friend, other])).rejects.toThrow();
    expect((await member()).collection_id).toBe(col);
    expect(await admin('select 1 from public.collection_members where collection_id = $1', [other])).toHaveLength(0);
  });

  it('a member cannot change its own role', async () => {
    await as(friend, "update public.collection_members set role = 'viewer' where collection_id = $1 and user_id = $2", [col, friend]);
    expect((await member()).role).toBe('editor');
  });
});
