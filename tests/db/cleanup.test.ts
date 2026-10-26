/** Scheduled cleanup functions (migration 20261023000004), executed on real PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;

d('scheduled cleanup', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('deletes old usage rows and keeps recent ones', async () => {
    const u = await mkUser(`cl_u_${s}`);
    await admin("insert into public.ai_usage (user_id, action, provider, key_source, created_at) values ($1, 'text:old', 'x', 'app', now() - interval '120 days'), ($1, 'text:new', 'x', 'app', now())", [u]);
    await admin("insert into public.daily_action_counts (user_id, action, day, n) values ($1, 'report', (now() - interval '120 days')::date, 3), ($1, 'report', (now() at time zone 'utc')::date, 1)", [u]);
    await admin("insert into public.rate_limit_events (bucket, created_at) values ($1, now() - interval '120 days'), ($1, now())", [`cl_${s}`]);
    await admin('select public.cleanup_old_usage(90)');
    expect((await admin('select action from public.ai_usage where user_id = $1', [u])).map((r) => r.action)).toEqual(['text:new']);
    expect((await admin('select n from public.daily_action_counts where user_id = $1', [u])).map((r) => r.n)).toEqual([1]);
    expect(Number((await admin('select count(*) from public.rate_limit_events where bucket = $1', [`cl_${s}`]))[0].count)).toBe(1);
  });

  it('lists only old storage objects without a recipe_images row', async () => {
    const u = await mkUser(`cl_o_${s}`);
    const [{ id: recipe }] = await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'P', 'private') returning id", [u]);
    await admin("insert into storage.buckets (id, name) values ('recipe-images', 'recipe-images') on conflict do nothing");
    const p = (n: string) => `${u}/${n}`;
    await admin("insert into public.recipe_images (recipe_id, owner_id, storage_path, thumb_path) values ($1, $2, $3, $4)", [recipe, u, p('kept.webp'), p('kept_t.webp')]);
    const old = "now() - interval '2 days'";
    await admin(`insert into storage.objects (bucket_id, name, created_at) values ('recipe-images', $1, ${old}), ('recipe-images', $2, ${old}), ('recipe-images', $3, ${old}), ('recipe-images', $4, now())`, [
      p('kept.webp'), p('kept_t.webp'), p('orphan.webp'), p('fresh.webp'),
    ]);
    const names = (await admin('select name from public.list_orphan_images(1000)')).map((r) => r.name);
    expect(names).toContain(p('orphan.webp'));
    expect(names).not.toContain(p('kept.webp'));
    expect(names).not.toContain(p('kept_t.webp'));
    expect(names).not.toContain(p('fresh.webp'));
  });

  it('lists only old avatar files that no profile references', async () => {
    const u = await mkUser(`cl_a_${s}`);
    await admin("insert into storage.buckets (id, name) values ('avatars', 'avatars') on conflict do nothing");
    const p = (n: string) => `${u}/${n}`;
    await admin('update public.profiles set avatar_path = $2 where id = $1', [u, p('current.webp')]);
    const old = "now() - interval '2 days'";
    await admin(`insert into storage.objects (bucket_id, name, created_at) values ('avatars', $1, ${old}), ('avatars', $2, ${old}), ('avatars', $3, now())`, [
      p('current.webp'), p('stale.webp'), p('fresh.webp'),
    ]);
    const names = (await admin('select name from public.list_orphan_avatars(1000)')).map((r) => r.name);
    expect(names).toContain(p('stale.webp'));
    expect(names).not.toContain(p('current.webp'));
    expect(names).not.toContain(p('fresh.webp'));
  });

  it('deletes invites past the grace period and old meal reminders, keeps the rest (A-28)', async () => {
    const u = await mkUser(`cl_i_${s}`);
    const h = (n: string) => n.repeat(64);
    await admin(
      `insert into public.invites (inviter_id, token_hash, expires_at, revoked_at) values
        ($1, $2, now() - interval '60 days', null),
        ($1, $3, now() - interval '5 days', null),
        ($1, $4, now() + interval '5 days', null),
        ($1, $5, now() + interval '5 days', now() - interval '60 days')`,
      [u, h('a'), h('b'), h('c'), h('d')],
    );
    const entries = await admin(
      "insert into public.meal_plan_entries (owner_id, plan_date, slot, title) values ($1, '2031-05-01', 'dinner', 'A'), ($1, '2031-05-02', 'dinner', 'B') returning id, title",
      [u],
    );
    const old = entries.find((e) => e.title === 'A').id;
    const fresh = entries.find((e) => e.title === 'B').id;
    await admin("insert into public.meal_reminders_sent (entry_id, sent_at) values ($1, now() - interval '90 days'), ($2, now())", [old, fresh]);

    await admin('select public.cleanup_stale_rows(30, 30)');
    expect((await admin('select token_hash from public.invites where inviter_id = $1 order by token_hash', [u])).map((r) => r.token_hash)).toEqual([h('b'), h('c')]);
    expect((await admin('select entry_id from public.meal_reminders_sent where entry_id in ($1, $2)', [old, fresh])).map((r) => r.entry_id)).toEqual([fresh]);
  });

  it('is not executable by clients', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select public.cleanup_old_usage(90)')).rejects.toThrow();
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select public.cleanup_stale_rows(30, 30)')).rejects.toThrow();
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select * from public.list_orphan_images(10)')).rejects.toThrow();
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select * from public.list_orphan_avatars(10)')).rejects.toThrow();
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
