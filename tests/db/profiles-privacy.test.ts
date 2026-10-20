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
    const rows = await as<{ username: string }>(bob, 'select id, username, display_name, bio from public.profiles where id = $1', [alice]);
    expect(rows).toHaveLength(1);
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
