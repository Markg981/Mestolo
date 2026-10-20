/**
 * feed_recipes: personalized "Per te" feed. SECURITY INVOKER, so RLS decides what can appear;
 * scoring is deterministic at a snapshot instant, so keyset pagination has no duplicates or gaps.
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

interface FeedRow {
  id: string;
  score: string;
  is_friend: boolean;
  matched_tags: string[];
  favorite_count: number;
}

d('feed_recipes', () => {
  const s = Math.random().toString(36).slice(2, 7);
  const users: string[] = [];
  let me: string;
  let friend: string;
  let stranger: string;
  let blocked: string;
  const ids: Record<string, string> = {};
  let snapshot: string;

  /** Rows are inserted normally, then back-dated bypassing the trigger that pins created_at to now(). */
  async function backdate(sql: string, params: unknown[]): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(sql, params);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  const add = async (owner: string, title: string, visibility: string, tags: string[] = [], extra: { hidden?: boolean; at?: string } = {}) => {
    const id = (
      await admin<{ id: string }>(
        'insert into public.recipes (owner_id, title, visibility, tags, is_hidden) values ($1, $2, $3, $4, $5) returning id',
        [owner, title, visibility, tags, extra.hidden ?? false],
      )
    )[0].id;
    await backdate("update public.recipes set created_at = coalesce($2::timestamptz, now() - interval '1 hour') where id = $1", [id, extra.at ?? null]);
    return id;
  };

  const feed = (uid: string, args = '') =>
    as<FeedRow>(uid, `select * from public.feed_recipes(p_now => $1::timestamptz ${args})`, [snapshot]);

  /** Walks every page with the keyset cursor, returning all ids in order. */
  async function walk(uid: string, size: number): Promise<FeedRow[]> {
    const all: FeedRow[] = [];
    let before: FeedRow | null = null;
    for (let i = 0; i < 200; i++) {
      const page: FeedRow[] = await as<FeedRow>(
        uid,
        'select * from public.feed_recipes(p_limit => $1, p_now => $2::timestamptz, p_before_score => $3, p_before_id => $4)',
        [size, snapshot, before?.score ?? null, before?.id ?? null],
      );
      all.push(...page);
      if (page.length < size) break;
      before = page[page.length - 1];
    }
    return all;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    me = await createUser(`fdme_${s}`);
    friend = await createUser(`fdfr_${s}`);
    stranger = await createUser(`fdst_${s}`);
    blocked = await createUser(`fdbl_${s}`);
    users.push(me, friend, stranger, blocked);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [me, friend]);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [me, blocked]);

    // the user's tastes: pasta + vegetariano
    ids.mine = await add(me, 'Mia pasta', 'private', ['pasta', 'vegetariano']);
    ids.minePublic = await add(me, 'Mia pubblica', 'public', ['pasta']);
    ids.friendFriends = await add(friend, 'Amico solo amici', 'friends', ['carne']);
    ids.friendPrivate = await add(friend, 'Amico privata', 'private', ['pasta']);
    ids.strangerFriends = await add(stranger, 'Sconosciuto solo amici', 'friends', ['pasta']);
    ids.strangerPrivate = await add(stranger, 'Sconosciuto privata', 'private', ['pasta']);
    ids.strangerHidden = await add(stranger, 'Sconosciuto nascosta', 'public', ['pasta'], { hidden: true });
    ids.blockedPublic = await add(blocked, 'Bloccato pubblica', 'public', ['pasta']);
    // same age, different relevance, different authors
    const at = new Date(Date.now() - 3600_000).toISOString();
    const other = await createUser(`fdot_${s}`);
    users.push(other);
    ids.tagMatch = await add(stranger, 'Pasta al pomodoro', 'public', ['Pasta', 'vegetariano'], { at });
    ids.noMatch = await add(other, 'Arrosto', 'public', ['carne'], { at });
    // diversity: one author with many equal recipes vs a single one from another author
    const prolific = await createUser(`fdpr_${s}`);
    users.push(prolific);
    ids.p1 = await add(prolific, 'Prolifico 1', 'public', ['zzdiv'], { at });
    ids.p2 = await add(prolific, 'Prolifico 2', 'public', ['zzdiv'], { at });
    ids.p3 = await add(prolific, 'Prolifico 3', 'public', ['zzdiv'], { at });
    const solo = await createUser(`fdso_${s}`);
    users.push(solo);
    ids.single = await add(solo, 'Singola', 'public', ['zzdiv'], { at });
    // a recipe already favorited by the user
    ids.fav = await add(other, 'Gia preferita', 'public', ['pasta'], { at });
    await admin('insert into public.favorites (user_id, recipe_id) values ($1, $2)', [me, ids.fav]);
    snapshot = (await admin<{ n: string }>("select (now() + interval '1 minute')::text as n"))[0].n;
  });

  afterAll(async () => {
    if (pool) await admin('delete from auth.users where id = any($1::uuid[])', [users]).catch(() => undefined);
    await pool?.end();
  });

  it('never returns private, hidden, blocked or strangers\' friends-only recipes, nor own recipes', async () => {
    const got = new Set((await walk(me, 7)).map((r) => r.id));
    for (const k of ['strangerFriends', 'strangerPrivate', 'strangerHidden', 'blockedPublic', 'friendPrivate', 'mine', 'minePublic']) {
      expect(got.has(ids[k]), k).toBe(false);
    }
    expect(got.has(ids.friendFriends)).toBe(true);
    expect(got.has(ids.tagMatch)).toBe(true);
  });

  it('excludes already favorited recipes unless asked', async () => {
    expect((await walk(me, 50)).some((r) => r.id === ids.fav)).toBe(false);
    const withFav = await feed(me, ', p_exclude_favorited => false, p_limit => 100');
    expect(withFav.some((r) => r.id === ids.fav)).toBe(true);
  });

  it('puts friends first and flags them', async () => {
    const rows = await feed(me);
    expect(rows[0].id).toBe(ids.friendFriends);
    expect(rows[0].is_friend).toBe(true);
  });

  it('ranks tag overlap higher and explains the matching tags', async () => {
    const rows = await walk(me, 50);
    const pos = (id: string) => rows.findIndex((r) => r.id === id);
    expect(pos(ids.tagMatch)).toBeGreaterThanOrEqual(0);
    expect(pos(ids.tagMatch)).toBeLessThan(pos(ids.noMatch));
    expect(rows[pos(ids.tagMatch)].matched_tags).toEqual(expect.arrayContaining(['pasta', 'vegetariano']));
  });

  it('spreads authors: a prolific author does not crowd out a single-recipe author', async () => {
    const rows = await walk(me, 50);
    const pos = (id: string) => rows.findIndex((r) => r.id === id);
    const prolificPositions = [ids.p1, ids.p2, ids.p3].map(pos).sort((x, y) => x - y);
    expect(pos(ids.single)).toBeLessThan(prolificPositions[1]);
  });

  it('paginates without duplicates or gaps', async () => {
    const whole = (await feed(me, ', p_limit => 100')).map((r) => r.id);
    const paged = (await walk(me, 3)).map((r) => r.id);
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(whole.length < 100 ? whole : paged);
    expect(paged.length).toBeGreaterThanOrEqual(8);
  });

  it('counts favorites as a popularity signal without exposing who', async () => {
    const popular = await add(stranger, 'Popolare', 'public', ['zzpop'], { at: new Date(Date.now() - 3600_000).toISOString() });
    const quiet = await add(stranger, 'Tranquilla', 'public', ['zzpop'], { at: new Date(Date.now() - 3600_000).toISOString() });
    const fan = await createUser(`fdfa_${s}`);
    users.push(fan);
    await admin('insert into public.favorites (user_id, recipe_id) values ($1, $2)', [fan, popular]);
    const rows = await walk(me, 50);
    const p = rows.find((r) => r.id === popular);
    expect(p?.favorite_count).toBe(1);
    expect(rows.findIndex((r) => r.id === popular)).toBeLessThan(rows.findIndex((r) => r.id === quiet));
    // the count helper reveals nothing for recipes the caller cannot see
    const hidden = await as<{ n: number }>(me, 'select public.favorite_count($1) as n', [ids.strangerPrivate]);
    expect(hidden[0].n).toBe(0);
  });

  it('is not callable anonymously', async () => {
    await expect(as(null, 'select * from public.feed_recipes()')).rejects.toThrow();
  });

  it('stays fast with a few thousand candidates', async () => {
    const authors: string[] = [];
    for (let i = 0; i < 10; i++) authors.push(await createUser(`fdpf${i}_${s}`));
    users.push(...authors);
    await admin(
      `insert into public.recipes (owner_id, title, visibility, tags)
       select ($1::uuid[])[1 + (g % 10)], 'Perf ' || g, 'public', array['t' || (g % 40), 'pasta']
       from generate_series(1, 3000) g`,
      [authors],
    );
    await backdate(
      `update public.recipes set created_at = now() - (substr(title, 6)::int % 25) * interval '1 day' - interval '2 hours'
       where owner_id = any($1::uuid[]) and title like 'Perf %'`,
      [authors],
    );
    const t0 = Date.now();
    const rows = await feed(me, ', p_limit => 24');
    expect(rows.length).toBe(24);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
