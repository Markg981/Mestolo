/**
 * RLS policies that depend on is_blocked_between.
 *
 * Latest definitions (migration 20261102000001_is_blocked_between_no_leak.sql rewrites every
 * policy / public function that called public.is_blocked_between so it calls the symmetric
 * private.is_blocked_between; the public one only answers "did the caller block the other"):
 *   - public.friendships        friendships_insert            (20261020000001_init.sql)
 *   - public.recipes            recipes_select                (20261020000001_init.sql)
 *   - public.cook_logs          cook_logs_select              (20261025000003_cook_logs.sql)
 *   - public.shopping_list_members shopping_list_members_insert (20261025011000_shopping_aisles_family.sql)
 *   - public.collection_members collection_members_insert     (20261025000002_shared_collections.sql)
 *   - via public.can_access_shopping_list (20261025015000): shopping_lists_select,
 *     shopping_items_select/insert/update/delete, shopping_list_members_select
 *   - via public.collection_role_for / can_view_collection (20261025015000): collections_select_shared,
 *     collection_recipes_select
 *   - via public.can_see_profile (20261025021000): profiles_select
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

/** Inserts a block without firing the triggers that drop friendships / shared membership. */
async function block(blocker: string, blocked: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [blocker, blocked]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const befriend = (x: string, y: string) =>
  admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [x, y]);

const suffix = Math.random().toString(36).slice(2, 7);
let counter = 0;
/** Two fresh users per scenario so tests never interfere. */
async function pair(): Promise<{ x: string; y: string }> {
  const n = ++counter;
  return { x: await createUser(`bbx${n}_${suffix}`), y: await createUser(`bby${n}_${suffix}`) };
}

d('is_blocked_between: function', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const pub = (uid: string | null, p: string, q: string) =>
    as<{ r: boolean }>(uid, 'select public.is_blocked_between($1, $2) as r', [p, q]).then((rows) => rows[0].r);
  const priv = (uid: string | null, p: string, q: string) =>
    as<{ r: boolean }>(uid, 'select private.is_blocked_between($1, $2) as r', [p, q]).then((rows) => rows[0].r);

  it('private version is symmetric for both parties and either argument order', async () => {
    const { x, y } = await pair();
    await block(x, y);
    for (const who of [x, y]) {
      expect(await priv(who, x, y)).toBe(true);
      expect(await priv(who, y, x)).toBe(true);
    }
  });

  it('private version is false without a block', async () => {
    const { x, y } = await pair();
    expect(await priv(x, x, y)).toBe(false);
    expect(await priv(y, y, x)).toBe(false);
  });

  it('public version only tells the caller that THEY blocked the other (blocked user learns nothing)', async () => {
    const { x, y } = await pair();
    await block(x, y);
    expect(await pub(x, x, y)).toBe(true);
    expect(await pub(x, y, x)).toBe(true);
    expect(await pub(y, x, y)).toBe(false);
    expect(await pub(y, y, x)).toBe(false);
  });

  it('a third party cannot probe a block between two others', async () => {
    const { x, y } = await pair();
    const z = await createUser(`bbz_${suffix}_${++counter}`);
    await block(x, y);
    expect(await pub(z, x, y)).toBe(false);
    expect(await priv(z, x, y)).toBe(false);
  });

  it('returns a plain boolean, never null, even for unrelated or unknown ids', async () => {
    const { x, y } = await pair();
    const rows = await as<{ r: boolean | null }>(x, 'select public.is_blocked_between($1, gen_random_uuid()) as r', [y]);
    expect(rows[0].r).toBe(false);
    const sig = await admin<{ pub: string; priv: string }>(
      `select (select prorettype::regtype::text from pg_proc where oid = 'public.is_blocked_between(uuid,uuid)'::regprocedure) as pub,
              (select prorettype::regtype::text from pg_proc where oid = 'private.is_blocked_between(uuid,uuid)'::regprocedure) as priv`,
    );
    expect(sig[0]).toEqual({ pub: 'boolean', priv: 'boolean' });
  });

  it('anon cannot execute either version; authenticated can', async () => {
    const { x, y } = await pair();
    const g = await admin<{ a_pub: boolean; u_pub: boolean; a_priv: boolean; u_priv: boolean; usage_anon: boolean; usage_auth: boolean }>(
      `select has_function_privilege('anon', 'public.is_blocked_between(uuid,uuid)', 'execute') as a_pub,
              has_function_privilege('authenticated', 'public.is_blocked_between(uuid,uuid)', 'execute') as u_pub,
              has_function_privilege('anon', 'private.is_blocked_between(uuid,uuid)', 'execute') as a_priv,
              has_function_privilege('authenticated', 'private.is_blocked_between(uuid,uuid)', 'execute') as u_priv,
              has_schema_privilege('anon', 'private', 'usage') as usage_anon,
              has_schema_privilege('authenticated', 'private', 'usage') as usage_auth`,
    );
    expect(g[0]).toEqual({ a_pub: false, u_pub: true, a_priv: false, u_priv: true, usage_anon: false, usage_auth: true });
    await expect(pub(null, x, y)).rejects.toThrow(/permission denied/);
    await expect(priv(null, x, y)).rejects.toThrow(/permission denied/);
  });

  it('no policy still references the public version (all rewritten to private)', async () => {
    const rows = await admin<{ polname: string }>(
      `select polname from pg_policy
       where pg_get_expr(polqual, polrelid) ~ 'public\\.is_blocked_between'
          or pg_get_expr(polwithcheck, polrelid) ~ 'public\\.is_blocked_between'`,
    );
    expect(rows).toEqual([]);
    const used = await admin<{ polname: string }>(
      `select polname from pg_policy
       where pg_get_expr(polqual, polrelid) like '%private.is_blocked_between%'
          or pg_get_expr(polwithcheck, polrelid) like '%private.is_blocked_between%'`,
    );
    const names = used.map((r) => r.polname);
    for (const n of ['friendships_insert', 'recipes_select', 'cook_logs_select', 'shopping_list_members_insert', 'collection_members_insert']) {
      expect(names).toContain(n);
    }
  });
});

d('is_blocked_between: policies', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  // ---- recipes_select ---------------------------------------------------
  it('recipes_select: public recipe visible until either side blocks', async () => {
    const base = await pair();
    const [{ id }] = await as<{ id: string }>(base.x, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pub', 'public') returning id", [base.x]);
    expect(await as(base.y, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
    await block(base.x, base.y);
    expect(await as(base.y, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    expect(await as(base.x, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);

    const rev = await pair();
    const [{ id: rid }] = await as<{ id: string }>(rev.x, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pub', 'public') returning id", [rev.x]);
    await block(rev.y, rev.x); // the reader blocked the owner
    expect(await as(rev.y, 'select id from public.recipes where id = $1', [rid])).toHaveLength(0);
    expect(await as(rev.x, 'select id from public.recipes where id = $1', [rid])).toHaveLength(1);
  });

  it('recipes_select: friends-only recipe is hidden from a blocked friend (both directions)', async () => {
    for (const reverse of [false, true]) {
      const { x, y } = await pair();
      await befriend(x, y);
      const [{ id }] = await as<{ id: string }>(x, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Fr', 'friends') returning id", [x]);
      expect(await as(y, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
      await block(reverse ? y : x, reverse ? x : y);
      expect(await as(y, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    }
  });

  // ---- friendships_insert -----------------------------------------------
  it('friendships_insert: request succeeds without a block, fails when either side blocked', async () => {
    const ok = await pair();
    await as(ok.x, "insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [ok.x, ok.y]);

    const r1 = await pair();
    await block(r1.y, r1.x); // addressee blocked requester
    await expect(
      as(r1.x, "insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [r1.x, r1.y]),
    ).rejects.toThrow(/row-level security/);

    const r2 = await pair();
    await block(r2.x, r2.y); // requester blocked addressee
    await expect(
      as(r2.x, "insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [r2.x, r2.y]),
    ).rejects.toThrow(/row-level security/);
  });

  // ---- cook_logs_select -------------------------------------------------
  it('cook_logs_select: a shared log is hidden from a blocked reader (both directions), visible otherwise', async () => {
    for (const reverse of [false, true]) {
      const { x: author, y: reader } = await pair();
      const third = await createUser(`bbt_${suffix}_${++counter}`);
      // the recipe belongs to a third user so can_view_recipe is unaffected by the author/reader block
      const [{ id: rid }] = await as<{ id: string }>(third, "insert into public.recipes (owner_id, title, visibility) values ($1, 'R', 'public') returning id", [third]);
      const [{ id: lid }] = await as<{ id: string }>(
        author,
        "select public.insert_cook_log($1, now(), '', 'recipe', null, 0, 2000, 1) as id",
        [rid],
      );
      expect(await as(reader, 'select id from public.cook_logs where id = $1', [lid])).toHaveLength(1);
      await block(reverse ? reader : author, reverse ? author : reader);
      expect(await as(reader, 'select id from public.cook_logs where id = $1', [lid])).toHaveLength(0);
      expect(await as(author, 'select id from public.cook_logs where id = $1', [lid])).toHaveLength(1);
    }
  });

  // ---- shopping_list_members_insert ------------------------------------
  it('shopping_list_members_insert: owner can add a friend, not a blocked one (either direction)', async () => {
    const ok = await pair();
    await befriend(ok.x, ok.y);
    const lOk = (await admin<{ id: string }>("insert into public.shopping_lists (owner_id, name) values ($1, 'l') returning id", [ok.x]))[0].id;
    await as(ok.x, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [lOk, ok.y]);
    expect(await admin('select 1 from public.shopping_list_members where list_id = $1 and user_id = $2', [lOk, ok.y])).toHaveLength(1);

    for (const reverse of [false, true]) {
      const { x, y } = await pair();
      await befriend(x, y); // friendship kept (block inserted with triggers off) so only the block can deny
      await block(reverse ? y : x, reverse ? x : y);
      const lid = (await admin<{ id: string }>("insert into public.shopping_lists (owner_id, name) values ($1, 'l') returning id", [x]))[0].id;
      await expect(as(x, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [lid, y])).rejects.toThrow(/row-level security/);
    }
  });

  // ---- collection_members_insert ---------------------------------------
  it('collection_members_insert: owner can invite a friend, not a blocked one (either direction)', async () => {
    const ok = await pair();
    await befriend(ok.x, ok.y);
    const cOk = (await admin<{ id: string }>("insert into public.collections (owner_id, name) values ($1, 'c') returning id", [ok.x]))[0].id;
    await as(ok.x, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [cOk, ok.y]);
    expect(await admin('select 1 from public.collection_members where collection_id = $1 and user_id = $2', [cOk, ok.y])).toHaveLength(1);

    for (const reverse of [false, true]) {
      const { x, y } = await pair();
      await befriend(x, y);
      await block(reverse ? y : x, reverse ? x : y);
      const cid = (await admin<{ id: string }>("insert into public.collections (owner_id, name) values ($1, 'c') returning id", [x]))[0].id;
      await expect(
        as(x, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'viewer')", [cid, y]),
      ).rejects.toThrow(/row-level security/);
    }
  });

  // ---- shopping lists / items (can_access_shopping_list) ----------------
  it('shopping_lists / shopping_items policies: a member loses access once blocked (both directions)', async () => {
    for (const reverse of [false, true]) {
      const { x: owner, y: member } = await pair();
      await befriend(owner, member);
      const lid = (await admin<{ id: string }>("insert into public.shopping_lists (owner_id, name) values ($1, 'l') returning id", [owner]))[0].id;
      await as(owner, 'insert into public.shopping_list_members (list_id, user_id) values ($1, $2)', [lid, member]);
      const itemId = (await as<{ id: string }>(owner, "insert into public.shopping_items (list_id, name) values ($1, 'latte') returning id", [lid]))[0].id;

      // with no block the member has full access
      expect(await as(member, 'select id from public.shopping_lists where id = $1', [lid])).toHaveLength(1);
      expect(await as(member, 'select id from public.shopping_items where id = $1', [itemId])).toHaveLength(1);
      await as(member, "insert into public.shopping_items (list_id, name) values ($1, 'pane')", [lid]);
      expect(await as(member, 'update public.shopping_items set checked = true where id = $1 returning id', [itemId])).toHaveLength(1);

      await block(reverse ? member : owner, reverse ? owner : member);

      expect(await as(member, 'select id from public.shopping_lists where id = $1', [lid])).toHaveLength(0);
      expect(await as(member, 'select id from public.shopping_items where id = $1', [itemId])).toHaveLength(0);
      await expect(as(member, "insert into public.shopping_items (list_id, name) values ($1, 'uova')", [lid])).rejects.toThrow(/row-level security/);
      expect(await as(member, 'update public.shopping_items set checked = false where id = $1 returning id', [itemId])).toHaveLength(0);
      expect(await as(member, 'delete from public.shopping_items where id = $1 returning id', [itemId])).toHaveLength(0);
      // the owner keeps everything
      expect(await as(owner, 'select id from public.shopping_lists where id = $1', [lid])).toHaveLength(1);
      expect(await as(owner, 'select id from public.shopping_items where id = $1', [itemId])).toHaveLength(1);
    }
  });

  // ---- collections / collection_recipes (collection_role_for) -----------
  it('collections_select_shared / collection_recipes_select: member and public viewer lose access once blocked', async () => {
    for (const reverse of [false, true]) {
      const { x: owner, y: viewer } = await pair();
      await befriend(owner, viewer);
      const [{ id: rid }] = await as<{ id: string }>(owner, "insert into public.recipes (owner_id, title, visibility) values ($1, 'R', 'public') returning id", [owner]);
      const cid = (await admin<{ id: string }>("insert into public.collections (owner_id, name, visibility) values ($1, 'c', 'public') returning id", [owner]))[0].id;
      await as(owner, "insert into public.collection_members (collection_id, user_id, role) values ($1, $2, 'editor')", [cid, viewer]);
      await as(owner, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [cid, rid]);

      expect(await as(viewer, 'select id from public.collections where id = $1', [cid])).toHaveLength(1);
      expect(await as(viewer, 'select 1 from public.collection_recipes where collection_id = $1', [cid])).toHaveLength(1);

      await block(reverse ? viewer : owner, reverse ? owner : viewer);

      // even though the collection is public and the member row survived
      expect(await as(viewer, 'select id from public.collections where id = $1', [cid])).toHaveLength(0);
      expect(await as(viewer, 'select 1 from public.collection_recipes where collection_id = $1', [cid])).toHaveLength(0);
      expect(await as(viewer, 'select public.collection_role($1) as r', [cid]).then((r) => r[0].r)).toBeNull();
      expect(await as(owner, 'select id from public.collections where id = $1', [cid])).toHaveLength(1);
    }
  });

  // ---- profiles_select (can_see_profile) -------------------------------
  it('profiles_select: a blocked profile is hidden in both directions, own profile always visible', async () => {
    const base = await pair();
    expect(await as(base.y, 'select id from public.profiles where id = $1', [base.x])).toHaveLength(1);

    for (const reverse of [false, true]) {
      const { x, y } = await pair();
      expect(await as(y, 'select id from public.profiles where id = $1', [x])).toHaveLength(1);
      await block(reverse ? y : x, reverse ? x : y);
      expect(await as(y, 'select id from public.profiles where id = $1', [x])).toHaveLength(0);
      expect(await as(x, 'select id from public.profiles where id = $1', [y])).toHaveLength(0);
      expect(await as(x, 'select id from public.profiles where id = $1', [x])).toHaveLength(1);
      expect(await as(y, 'select id from public.profiles where id = $1', [y])).toHaveLength(1);
    }
  });

  it('unblocking restores access', async () => {
    const { x, y } = await pair();
    const [{ id }] = await as<{ id: string }>(x, "insert into public.recipes (owner_id, title, visibility) values ($1, 'Pub', 'public') returning id", [x]);
    await block(x, y);
    expect(await as(y, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    await as(x, 'delete from public.blocks where blocker_id = $1 and blocked_id = $2', [x, y]);
    expect(await as(y, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
  });
});

d('is_blocked_between: nessun uso della versione pubblica fuori dalla RPC (DB-01)', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const re = String.raw`(public\.|(^|[^.[:alnum:]_]))is_blocked_between\(`;

  it('nessuna funzione (qualsiasi schema) tranne la RPC stessa la richiama', async () => {
    const rows = await admin<{ n: string }>(
      `select s.nspname || '.' || p.proname as n
         from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where p.prosrc ~ $1
          and not (s.nspname = 'public' and p.proname = 'is_blocked_between')`,
      [re],
    );
    expect(rows).toEqual([]);
  });

  it('nessuna policy (inclusa storage.objects) la richiama', async () => {
    const rows = await admin<{ n: string }>(
      `select c.relnamespace::regnamespace || '.' || c.relname || '.' || p.polname as n
         from pg_policy p join pg_class c on c.oid = p.polrelid
        where coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ $1`,
      [re],
    );
    expect(rows).toEqual([]);
  });
});

d('profili e avatar: blocco simmetrico (DB-01)', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function setup() {
    const { x, y } = await pair();
    await admin("update public.profiles set profile_visibility = 'public', avatar_path = id::text || '/a.webp' where id in ($1, $2)", [x, y]);
    await admin(
      `insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2), ('avatars', $3, $4)`,
      [`${x}/a.webp`, x, `${y}/a.webp`, y],
    );
    return { x, y };
  }

  async function sees(viewer: string, owner: string, username: string) {
    const det = await as<{ r: boolean }>(viewer, 'select public.can_view_profile_details($1, $2) as r', [owner, viewer]);
    const card = await as<{ can_view: boolean }>(viewer, 'select can_view from public.get_profile_card($1)', [username]);
    const av = await as(viewer, 'select * from public.get_avatar_paths($1)', [[owner]]);
    const obj = await as(viewer, "select 1 from storage.objects where bucket_id = 'avatars' and name = $1", [`${owner}/a.webp`]);
    return { det: det[0].r, card: card.length > 0 && card[0].can_view, av: av.length, obj: obj.length };
  }

  const usernameOf = async (id: string) => (await admin<{ username: string }>('select username from public.profiles where id = $1', [id]))[0].username;

  it('senza blocchi entrambi vedono dettagli e avatar', async () => {
    const { x, y } = await setup();
    expect(await sees(y, x, await usernameOf(x))).toEqual({ det: true, card: true, av: 1, obj: 1 });
  });

  for (const dir of ['x blocca y', 'y blocca x'] as const) {
    it(`${dir}: nessuno vede dettagli o avatar dell'altro`, async () => {
      const { x, y } = await setup();
      if (dir === 'x blocca y') await block(x, y);
      else await block(y, x);
      const none = { det: false, card: false, av: 0, obj: 0 };
      expect(await sees(x, y, await usernameOf(y))).toEqual(none);
      expect(await sees(y, x, await usernameOf(x))).toEqual(none);
    });
  }
});
