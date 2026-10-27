/** Column privileges on profiles (migration 20261022000002), executed on real PostgreSQL. */
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

d('profiles column privileges', () => {
  let alice: string, bob: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    [alice, bob] = await Promise.all(['pa', 'pb'].map((n) => user(`${n}_${s}`)));
    await admin("update public.profiles set dietary_preferences = '{vegan}', avoided_ingredients = '{noci}' where id = $1", [alice]);
  });
  afterAll(async () => pool?.end());

  it('other users read the public columns only', async () => {
    const rows = await as<{ username: string }>(bob, 'select id, username, display_name from public.profiles where id = $1', [alice]);
    expect(rows).toHaveLength(1);
  });

  it('profili non discoverable invisibili agli estranei, visibili a se stessi e agli amici (M2)', async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const [hidden, friend] = await Promise.all(['ph', 'pf'].map((n) => user(`${n}_${s}`)));
    await admin('update public.profiles set discoverable = false where id = $1', [hidden]);
    const q = 'select id from public.profiles where id = $1';
    expect(await as(bob, q, [hidden])).toHaveLength(0);
    expect(await as(hidden, q, [hidden])).toHaveLength(1);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [hidden, friend]);
    expect(await as(friend, q, [hidden])).toHaveLength(1);
    await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'pubblica', 'public')", [hidden]);
    expect(await as(bob, q, [hidden])).toHaveLength(1);
  });

  it('a stranger cannot enumerate hidden profiles in bulk or through search (M2)', async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const [hidden, open, blocker, pending, stranger] = await Promise.all(['eh', 'eo', 'eb', 'ep', 'es'].map((n) => user(`${n}_${s}`)));
    await admin('update public.profiles set discoverable = false where id = any($1)', [[hidden, pending]]);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [blocker, stranger]);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [pending, stranger]);
    const seen = (await as<{ id: string }>(stranger, 'select id from public.profiles where username like $1', [`%_${s}`])).map((r) => r.id).sort();
    expect(seen).toEqual([open, pending, stranger].sort());
    const search = async (name: string) => (await as<{ id: string }>(stranger, 'select id from public.search_profiles($1)', [`${name}_${s}`])).map((r) => r.id);
    expect(await search('eo')).toEqual([open]);
    for (const name of ['eh', 'eb', 'ep', 'es']) expect(await search(name)).toEqual([]);
    expect(await as(stranger, 'select public.can_see_profile($1) as ok', [hidden])).toEqual([{ ok: false }]);
  });

  it('amicizie pending (in uscita) o declined non rendono visibile un profilo privato (C-24)', async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const [priv, reqr, decl, inc] = await Promise.all(['cp', 'cr', 'cd', 'ci'].map((n) => user(`${n}_${s}`)));
    await admin('update public.profiles set discoverable = false where id = any($1)', [[priv, inc]]);
    const q = 'select public.can_see_profile($1) as ok';
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [reqr, priv]);
    expect(await as(reqr, q, [priv])).toEqual([{ ok: false }]);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'declined')", [decl, priv]);
    expect(await as(decl, q, [priv])).toEqual([{ ok: false }]);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'pending')", [inc, reqr]);
    expect(await as(reqr, q, [inc])).toEqual([{ ok: true }]);
    await admin("delete from public.friendships where requester_id = $1 and addressee_id = $2", [reqr, priv]);
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [reqr, priv]);
    expect(await as(reqr, q, [priv])).toEqual([{ ok: true }]);
  });
  it('a block hides even a discoverable profile with public recipes, both ways', async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const [author, reader] = await Promise.all(['ba', 'br'].map((n) => user(`${n}_${s}`)));
    await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'pubblica', 'public')", [author]);
    const q = 'select id from public.profiles where id = $1';
    expect(await as(reader, q, [author])).toHaveLength(1);
    await admin('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [reader, author]);
    expect(await as(reader, q, [author])).toHaveLength(0);
    expect(await as(author, q, [reader])).toHaveLength(0);
    expect(await as(author, q, [author])).toHaveLength(1);
  });

  it('anon has no access to profiles', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      await expect(c.query('select id from public.profiles')).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('bio now goes through get_profile_card (migration 20261025000006)', async () => {
    await expect(as(bob, 'select bio from public.profiles where id = $1', [alice])).rejects.toThrow(/permission denied/);
  });

  it.each(['dietary_preferences', 'avoided_ingredients', 'hidden_categories', 'locale', 'discoverable', 'is_moderator'])(
    'other users cannot read %s',
    async (col) => {
      await expect(as(bob, `select ${col} from public.profiles where id = $1`, [alice])).rejects.toThrow(/permission denied/);
    },
  );

  it('select * on profiles is denied', async () => {
    await expect(as(bob, 'select * from public.profiles')).rejects.toThrow(/permission denied/);
  });

  it('the owner reads the full profile through my_profile()', async () => {
    const rows = await as<{ id: string; dietary_preferences: string[]; avoided_ingredients: string[] }>(alice, 'select * from public.my_profile()');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(alice);
    expect(rows[0].dietary_preferences).toEqual(['vegan']);
    expect(rows[0].avoided_ingredients).toEqual(['noci']);
  });

  it('my_profile() never returns someone else', async () => {
    const rows = await as<{ id: string }>(bob, 'select * from public.my_profile()');
    expect(rows.map((r) => r.id)).toEqual([bob]);
  });

  it('the owner can still update the own profile', async () => {
    await as(alice, "update public.profiles set bio = 'ciao' where id = $1", [alice]);
    const [p] = await admin<{ bio: string }>('select bio from public.profiles where id = $1', [alice]);
    expect(p.bio).toBe('ciao');
  });

  it('search_profiles and is_moderator keep working', async () => {
    await as(bob, 'select * from public.search_profiles($1)', ['pa_']);
    expect((await as<{ m: boolean }>(bob, 'select public.is_moderator() as m'))[0].m).toBe(false);
  });
});
