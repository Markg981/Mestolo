/**
 * Shared collections: RLS matrix owner / editor / viewer / friend / stranger / anon,
 * and private recipes inside shared collections.
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
  const rows = await admin<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
    `${username}@example.test`,
    JSON.stringify({ username, locale: 'it' }),
  ]);
  return rows[0].id;
}

async function recipe(owner: string, title: string, visibility: string): Promise<string> {
  const rows = await admin<{ id: string }>('insert into public.recipes (owner_id, title, visibility) values ($1, $2, $3) returning id', [owner, title, visibility]);
  return rows[0].id;
}

d('Shared collections RLS', () => {
  let owner: string;
  let editor: string;
  let viewer: string;
  let friend: string;
  let stranger: string;
  let col: string;
  let pubR: string;
  let privR: string;
  let editorR: string;

  const visible = (uid: string | null) => as<{ id: string }>(uid, 'select id from public.collections where id = $1', [col]).then((r) => r.length === 1);
  const links = (uid: string | null) => as<{ recipe_id: string }>(uid, 'select recipe_id from public.collection_recipes where collection_id = $1', [col]).then((r) => r.map((x) => x.recipe_id));
  const setVis = (v: string) => admin('update public.collections set visibility = $1 where id = $2', [v, col]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    owner = await createUser(`sco_${s}`);
    editor = await createUser(`sce_${s}`);
    viewer = await createUser(`scv_${s}`);
    friend = await createUser(`scf_${s}`);
    stranger = await createUser(`scs_${s}`);
    for (const u of [editor, viewer, friend]) {
      await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [owner, u]);
    }
    pubR = await recipe(owner, 'Pubblica', 'public');
    privR = await recipe(owner, 'Privata', 'private');
    editorR = await recipe(editor, 'Dell editor', 'public');
    col = (await as<{ id: string }>(owner, "insert into public.collections (name) values ('Condivisa') returning id"))[0].id;
    await as(owner, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2), ($1, $3)', [col, pubR, privR]);
    await as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')", [col, editor, viewer]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('defaults to private: only owner and invited members see it', async () => {
    expect(await visible(owner)).toBe(true);
    expect(await visible(editor)).toBe(true);
    expect(await visible(viewer)).toBe(true);
    expect(await visible(friend)).toBe(false);
    expect(await visible(stranger)).toBe(false);
    expect(await visible(null)).toBe(false);
  });

  it('friends visibility opens it to friends only', async () => {
    await setVis('friends');
    expect(await visible(friend)).toBe(true);
    expect(await visible(stranger)).toBe(false);
    expect(await visible(null)).toBe(false);
  });

  it('public visibility opens it to every authenticated user, not anon', async () => {
    await setVis('public');
    expect(await visible(stranger)).toBe(true);
    expect(await visible(null)).toBe(false);
    expect((await as(null, 'select 1 from public.collection_members')).length).toBe(0);
    await setVis('private');
  });

  it('a blocked user loses access even when public or invited', async () => {
    await setVis('public');
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [owner, stranger]);
    expect(await visible(stranger)).toBe(false);
    await admin('delete from public.blocks where blocker_id = $1 and blocked_id = $2', [owner, stranger]);
    await setVis('private');
  });

  it('private recipes in a shared collection stay hidden from non-owners', async () => {
    await setVis('public');
    for (const u of [editor, viewer, friend, stranger]) {
      const ids = await links(u);
      expect(ids).toContain(pubR);
      expect(ids).toContain(privR); // the link is visible...
      const rows = await as<{ id: string }>(u, 'select id from public.recipes where id = any($1)', [[pubR, privR]]);
      expect(rows.map((r) => r.id)).toEqual([pubR]); // ...the private recipe is not
    }
    const own = await as<{ id: string }>(owner, 'select id from public.recipes where id = any($1)', [[pubR, privR]]);
    expect(own).toHaveLength(2);
    await setVis('private');
  });

  it('owner manages members; editor, viewer and others cannot', async () => {
    await expect(as(editor, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [col, friend])).rejects.toThrow();
    await expect(as(viewer, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'editor')", [col, viewer])).rejects.toThrow();
    await expect(as(stranger, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [col, stranger])).rejects.toThrow();
    // owner cannot invite a non-friend
    await expect(as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [col, stranger])).rejects.toThrow();
    // owner can invite a friend and change role
    await as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [col, friend]);
    await as(owner, "update public.collection_members set role = 'editor' where collection_id = $1 and user_id = $2", [col, friend]);
    // editor cannot change roles (0 rows affected)
    await as(editor, "update public.collection_members set role = 'viewer' where collection_id = $1 and user_id = $2", [col, friend]);
    const role = await admin<{ role: string }>('select role from public.collection_members where collection_id = $1 and user_id = $2', [col, friend]);
    expect(role[0].role).toBe('editor');
    // editor cannot remove others
    await as(editor, 'delete from public.collection_members where collection_id = $1 and user_id = $2', [col, friend]);
    expect(await admin('select 1 from public.collection_members where collection_id = $1 and user_id = $2', [col, friend])).toHaveLength(1);
    // owner removes
    await as(owner, 'delete from public.collection_members where collection_id = $1 and user_id = $2', [col, friend]);
    expect(await visible(friend)).toBe(false);
  });

  it('members see their own membership; strangers see none', async () => {
    expect((await as(viewer, 'select 1 from public.collection_members where collection_id = $1', [col])).length).toBe(1);
    expect((await as(owner, 'select 1 from public.collection_members where collection_id = $1', [col])).length).toBe(2);
    expect((await as(stranger, 'select 1 from public.collection_members where collection_id = $1', [col])).length).toBe(0);
  });

  it('editor adds and removes recipes but only ones they can view', async () => {
    await as(editor, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [col, editorR]);
    expect(await links(owner)).toContain(editorR);
    // private recipe of the owner is not viewable by the editor, but it is already linked; a new one is rejected
    const priv2 = await recipe(owner, 'Privata 2', 'private');
    await expect(as(editor, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [col, priv2])).rejects.toThrow();
    await as(editor, 'delete from public.collection_recipes where collection_id = $1 and recipe_id = $2', [col, editorR]);
    expect(await links(owner)).not.toContain(editorR);
  });

  it('viewer, friend and stranger cannot modify recipes of the collection', async () => {
    await expect(as(viewer, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [col, pubR])).rejects.toThrow();
    await expect(as(stranger, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [col, pubR])).rejects.toThrow();
    await as(viewer, 'delete from public.collection_recipes where collection_id = $1 and recipe_id = $2', [col, pubR]);
    await as(stranger, 'delete from public.collection_recipes where collection_id = $1 and recipe_id = $2', [col, pubR]);
    expect(await links(owner)).toContain(pubR);
  });

  it('only the owner renames, changes visibility or deletes the collection', async () => {
    await as(editor, "update public.collections set name = 'Hack', visibility = 'public' where id = $1", [col]);
    await as(editor, 'delete from public.collections where id = $1', [col]);
    const row = await admin<{ name: string; visibility: string }>('select name, visibility from public.collections where id = $1', [col]);
    expect(row[0]).toEqual({ name: 'Condivisa', visibility: 'private' });
  });

  it('rejects invalid visibility and roles', async () => {
    await expect(as(owner, "update public.collections set visibility = 'world' where id = $1", [col])).rejects.toThrow();
    await expect(as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'admin')", [col, friend])).rejects.toThrow();
  });

  it('a member can leave; helper functions are not callable by anon', async () => {
    await as(viewer, 'delete from public.collection_members where collection_id = $1 and user_id = $2', [col, viewer]);
    expect(await visible(viewer)).toBe(false);
    await expect(as(null, 'select public.can_view_collection($1)', [col])).rejects.toThrow();
  });
});
