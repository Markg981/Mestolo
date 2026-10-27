/**
 * M-20: tetto inviti e soglia segnalazioni restano corretti con insert concorrenti
 * (migration 20261108000020: advisory lock per utente / per ricetta).
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const s = Math.random().toString(36).slice(2, 7);
const mkUser = async (name: string, old = false) =>
  (await admin(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at, created_at)
     values ($1, $2, now(), now() - $3::interval) returning id`,
    [`${name}@example.test`, JSON.stringify({ username: name }), old ? '30 days' : '0 days'],
  ))[0].id as string;

d('db race conditions', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
  });
  afterAll(async () => pool?.end());

  it('concurrent invites never exceed the cap of 10', async () => {
    const u = await mkUser(`rc_inv_${s}`);
    const res = await Promise.allSettled(
      Array.from({ length: 14 }, () =>
        admin('insert into public.invites (inviter_id, token_hash) values ($1, $2)', [
          u,
          createHash('sha256').update(randomBytes(16)).digest('hex'),
        ]),
      ),
    );
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const [{ n }] = await admin('select count(*)::int n from public.invites where inviter_id = $1', [u]);
    expect(n).toBe(10);
  });

  it('concurrent reports still trigger the review threshold', async () => {
    const owner = await mkUser(`rc_own_${s}`);
    const rid = (await admin("insert into public.recipes (owner_id, title, visibility) values ($1, 'R', 'public') returning id", [owner]))[0].id as string;
    const reporters = await Promise.all([1, 2, 3].map((i) => mkUser(`rc_rep${i}_${s}`, true)));
    await Promise.all(
      reporters.map((r) =>
        admin("insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [r, rid]),
      ),
    );
    const rows = await admin('select status from public.moderation_cases where recipe_id = $1', [rid]);
    expect(rows[0]?.status).toBe('in_review');
  });
});
