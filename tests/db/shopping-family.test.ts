/** Lista della spesa condivisa (migration 20261025011000) su PostgreSQL reale. */
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

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function createUser(username: string): Promise<string> {
  const rows = await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [
    `${username}@example.test`,
    JSON.stringify({ username, locale: 'it' }),
  ]);
  return rows[0].id;
}

d('Lista della spesa condivisa (RLS)', () => {
  let owner: string;
  let member: string;
  let friend: string;
  let stranger: string;
  let blockedFriend: string;
  let list: string;
  let item: string;

  const addMember = (by: string, uid: string) =>
    as(by, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [list, uid]);
  const visibleItems = (uid: string) => as<{ id: string }>(uid, 'select id from public.shopping_items where list_id = $1', [list]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    owner = await createUser(`sho_${s}`);
    member = await createUser(`shm_${s}`);
    friend = await createUser(`shf_${s}`);
    stranger = await createUser(`shs_${s}`);
    blockedFriend = await createUser(`shb_${s}`);
    for (const u of [member, friend, blockedFriend]) {
      await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [owner, u]);
    }
    list = (await admin<{ id: string }>('select id from public.shopping_lists where owner_id = $1', [owner]))[0].id;
    item = (await as<{ id: string }>(owner, "insert into public.shopping_items (list_id, name) values ($1, 'latte') returning id", [list]))[0].id;
    await addMember(owner, member);
  });

  afterAll(async () => {
    await admin('delete from auth.users where id = any($1)', [[owner, member, friend, stranger, blockedFriend]]);
    await pool?.end();
  });

  it('il membro vede la lista e gli articoli, il non membro no', async () => {
    expect((await visibleItems(member)).map((r) => r.id)).toContain(item);
    expect(await as(member, 'select id from public.shopping_lists where id = $1', [list])).toHaveLength(1);
    expect(await visibleItems(stranger)).toHaveLength(0);
    expect(await visibleItems(friend)).toHaveLength(0);
    expect(await as(stranger, 'select id from public.shopping_lists where id = $1', [list])).toHaveLength(0);
  });

  it('il membro aggiunge, spunta (checked_by) e rimuove articoli', async () => {
    const added = await as<{ id: string; owner_id: string }>(member, "insert into public.shopping_items (list_id, name) values ($1, 'pane') returning id, owner_id", [list]);
    expect(added[0].owner_id).toBe(member);
    const upd = await as<{ checked_by: string }>(member, 'update public.shopping_items set checked = true where id = $1 returning checked_by', [item]);
    expect(upd[0].checked_by).toBe(member);
    const unc = await as<{ checked_by: string | null }>(owner, 'update public.shopping_items set checked = false where id = $1 returning checked_by', [item]);
    expect(unc[0].checked_by).toBeNull();
    expect(await as(member, 'delete from public.shopping_items where id = $1 returning id', [added[0].id])).toHaveLength(1);
  });

  it('il non membro non puo aggiungere ne modificare ne cancellare', async () => {
    await expect(as(stranger, "insert into public.shopping_items (list_id, name) values ($1, 'x')", [list])).rejects.toThrow(/row-level security/);
    expect(await as(stranger, 'update public.shopping_items set checked = true where id = $1 returning id', [item])).toHaveLength(0);
    expect(await as(stranger, 'delete from public.shopping_items where id = $1 returning id', [item])).toHaveLength(0);
  });

  it('un articolo non cambia lista', async () => {
    const other = (await admin<{ id: string }>('select id from public.shopping_lists where owner_id = $1', [stranger]))[0].id;
    const r = await as<{ list_id: string }>(member, 'update public.shopping_items set list_id = $2 where id = $1 returning list_id', [item, other]).catch(() => []);
    if (r.length) expect(r[0].list_id).toBe(list);
  });

  it('il membro non gestisce i membri ne rinomina o cancella la lista', async () => {
    await expect(addMember(member, friend)).rejects.toThrow(/row-level security/);
    expect(await as(member, "update public.shopping_lists set name = 'mia' where id = $1 returning id", [list])).toHaveLength(0);
    expect(await as(member, 'delete from public.shopping_lists where id = $1 returning id', [list])).toHaveLength(0);
    // non puo togliere altri membri
    await addMember(owner, friend);
    expect(await as(member, 'delete from public.shopping_list_members where list_id = $1 and user_id = $2 returning user_id', [list, friend])).toHaveLength(0);
    expect(await as(friend, 'delete from public.shopping_list_members where list_id = $1 and user_id = $2 returning user_id', [list, friend])).toHaveLength(1);
  });

  it('il proprietario rinomina la lista', async () => {
    expect(await as(owner, "update public.shopping_lists set name = 'Casa' where id = $1 returning id", [list])).toHaveLength(1);
  });

  it('non amici e utenti bloccati non sono aggiungibili', async () => {
    await expect(addMember(owner, stranger)).rejects.toThrow(/row-level security/);
    await expect(addMember(owner, owner)).rejects.toThrow(/row-level security/);
    // l'amico bloccato non e piu amico: blocco con amicizia gia esistente
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [owner, blockedFriend]);
    await expect(addMember(owner, blockedFriend)).rejects.toThrow(/row-level security/);
  });

  it('il blocco toglie il membro dalla lista', async () => {
    await addMember(owner, friend);
    expect(await visibleItems(friend)).not.toHaveLength(0);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [friend, owner]);
    expect(await visibleItems(friend)).toHaveLength(0);
    expect(await admin('select 1 from public.shopping_list_members where list_id = $1 and user_id = $2', [list, friend])).toHaveLength(0);
  });

  it('reparti scelti: i membri li salvano, i non membri no', async () => {
    const up = "insert into public.shopping_aisle_overrides (list_id, name_key, aisle, set_by) values ($1, 'latte', 'beverages', $2) on conflict (list_id, name_key) do update set aisle = excluded.aisle";
    await as(member, up, [list, member]);
    expect(await as<{ aisle: string }>(owner, 'select aisle from public.shopping_aisle_overrides where list_id = $1', [list])).toEqual([{ aisle: 'beverages' }]);
    await expect(as(stranger, up, [list, stranger])).rejects.toThrow(/row-level security/);
    expect(await as(stranger, 'select 1 from public.shopping_aisle_overrides where list_id = $1', [list])).toHaveLength(0);
  });

  it('il membro puo lasciare la lista e perde l accesso; il proprietario puo rimuovere un membro', async () => {
    expect(await as(member, 'delete from public.shopping_list_members where list_id = $1 and user_id = $2 returning user_id', [list, member])).toHaveLength(1);
    expect(await visibleItems(member)).toHaveLength(0);
    await expect(as(member, "insert into public.shopping_items (list_id, name) values ($1, 'y')", [list])).rejects.toThrow(/row-level security/);

    await addMember(owner, member);
    expect(await visibleItems(member)).not.toHaveLength(0);
    expect(await as(owner, 'delete from public.shopping_list_members where list_id = $1 and user_id = $2 returning user_id', [list, member])).toHaveLength(1);
    expect(await visibleItems(member)).toHaveLength(0);
  });
});
