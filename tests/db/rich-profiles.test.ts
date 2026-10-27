/** Rich profiles (migration 20261025000006): visibility matrix self / friend / stranger / anon, storage policies. */
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
    if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
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

type Card = { username: string; can_view: boolean; bio: string; location: string; website: string | null; friends_count: number | null; avatar_path: string | null };
const card = (viewer: string | null, username: string) => as<Card>(viewer, 'select * from public.get_profile_card($1)', [username]);

d('rich profiles', () => {
  let owner: string, friend: string, stranger: string, blocked: string;
  let names: Record<string, string>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const s = Math.random().toString(36).slice(2, 7);
    names = { owner: `ro_${s}`, friend: `rf_${s}`, stranger: `rs_${s}`, blocked: `rb_${s}` };
    [owner, friend, stranger, blocked] = await Promise.all(Object.values(names).map(user));
    await admin("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [owner, friend]);
    await admin("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [owner, blocked]);
    await admin("update public.profiles set bio = 'ciao', location = 'Roma', website = 'https://example.com', favorite_cuisines = '{italiana}', avatar_path = $2 where id = $1", [owner, `${owner}/a.webp`]);
    await admin("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${owner}/a.webp`]);
  });
  afterAll(async () => pool?.end());

  const setVisibility = (v: string) => admin('update public.profiles set profile_visibility = $2 where id = $1', [owner, v]);

  it('can_view_profile_details ignores a caller-supplied viewer (A-19)', async () => {
    await setVisibility('public');
    const [own] = await as<{ ok: boolean }>(stranger, 'select public.can_view_profile_details($1, $2) as ok', [owner, stranger]);
    expect(own.ok).toBe(true);
    const [spoof] = await as<{ ok: boolean }>(stranger, 'select public.can_view_profile_details($1, $2) as ok', [owner, owner]);
    expect(spoof.ok).toBe(false);
  });

  it('defaults to friends', async () => {
    await setVisibility('friends');
    const [p] = await admin<{ profile_visibility: string }>('select profile_visibility from public.profiles where id = $1', [stranger]);
    expect(p.profile_visibility).toBe('friends');
  });

  it('friends visibility: self and friend see everything, stranger only name and username, anon nothing', async () => {
    await setVisibility('friends');
    const self = (await card(owner, names.owner))[0];
    expect(self).toMatchObject({ can_view: true, bio: 'ciao', location: 'Roma', website: 'https://example.com', avatar_path: `${owner}/a.webp` });
    const fr = (await card(friend, names.owner))[0];
    expect(fr).toMatchObject({ can_view: true, bio: 'ciao', friends_count: 1 });
    const st = (await card(stranger, names.owner))[0];
    expect(st).toMatchObject({ can_view: false, bio: '', location: '', website: null, avatar_path: null, friends_count: null });
    expect(await card(null, names.owner)).toHaveLength(0);
  });

  it('public visibility: every signed-in user and anon see the card', async () => {
    await setVisibility('public');
    expect((await card(stranger, names.owner))[0]).toMatchObject({ can_view: true, bio: 'ciao' });
    expect((await card(null, names.owner))[0]).toMatchObject({ can_view: true, bio: 'ciao', website: 'https://example.com' });
  });

  it('private visibility: only the owner sees the details, even friends do not', async () => {
    await setVisibility('private');
    expect((await card(owner, names.owner))[0].can_view).toBe(true);
    expect((await card(friend, names.owner))[0]).toMatchObject({ can_view: false, bio: '' });
    expect(await card(null, names.owner)).toHaveLength(0);
  });

  it('a blocked user does not even find the profile', async () => {
    await setVisibility('public');
    expect(await card(blocked, names.owner)).toHaveLength(0);
  });

  it('other users cannot read the rich columns directly', async () => {
    for (const col of ['bio', 'avatar_path', 'location', 'website', 'favorite_cuisines', 'profile_visibility']) {
      await expect(as(stranger, `select ${col} from public.profiles where id = $1`, [owner])).rejects.toThrow(/permission denied/);
    }
    await expect(as(stranger, 'select id, username, display_name from public.profiles where id = $1', [owner])).resolves.toHaveLength(1);
  });

  it('the owner edits the text fields but cannot set avatar_path', async () => {
    await as(owner, "update public.profiles set location = 'Milano', profile_visibility = 'friends' where id = $1", [owner]);
    await expect(as(owner, "update public.profiles set avatar_path = $2 where id = $1", [owner, `${owner}/x.webp`])).rejects.toThrow(/permission denied/);
  });

  it('constraints: https website, limited cuisines, avatar in own folder', async () => {
    await expect(admin("update public.profiles set website = 'http://example.com' where id = $1", [owner])).rejects.toThrow(/profiles_website_https/);
    await expect(admin("update public.profiles set website = 'javascript:alert(1)' where id = $1", [owner])).rejects.toThrow(/profiles_website_https/);
    await expect(admin("update public.profiles set favorite_cuisines = array_fill('a'::text, array[9]) where id = $1", [owner])).rejects.toThrow(/profiles_cuisines_limits/);
    await expect(admin("update public.profiles set bio = repeat('x', 281) where id = $1", [owner])).rejects.toThrow();
    await expect(admin("update public.profiles set avatar_path = $2 where id = $1", [owner, `${stranger}/a.webp`])).rejects.toThrow(/profiles_avatar_own_folder/);
  });

  it('get_avatar_paths returns only avatars the caller may see', async () => {
    await setVisibility('friends');
    expect(await as(friend, 'select * from public.get_avatar_paths($1)', [[owner]])).toHaveLength(1);
    expect(await as(stranger, 'select * from public.get_avatar_paths($1)', [[owner]])).toHaveLength(0);
  });

  it('storage: avatar readable by owner and permitted viewers, never written by users', async () => {
    const sel = (uid: string) => as(uid, "select name from storage.objects where bucket_id = 'avatars'");
    await setVisibility('friends');
    expect((await sel(owner)).length).toBeGreaterThan(0);
    expect((await sel(friend)).some((r) => (r as { name: string }).name === `${owner}/a.webp`)).toBe(true);
    expect((await sel(stranger)).some((r) => (r as { name: string }).name === `${owner}/a.webp`)).toBe(false);
    await expect(as(owner, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${owner}/b.webp`])).rejects.toThrow(/row-level security/);
    await expect(as(stranger, "delete from storage.objects where bucket_id = 'avatars' and name = $1 returning 1", [`${owner}/a.webp`])).resolves.toHaveLength(0);
  });

  it('a stranger gets 0 rows for a non-discoverable profile (C-02)', async () => {
    await setVisibility('friends');
    await admin('update public.profiles set discoverable = false where id = $1', [owner]);
    try {
      expect(await card(stranger, names.owner)).toHaveLength(0);
      expect(await card(owner, names.owner)).toHaveLength(1);
      expect(await card(friend, names.owner)).toHaveLength(1);
    } finally {
      await admin('update public.profiles set discoverable = true where id = $1', [owner]);
    }
  });
});