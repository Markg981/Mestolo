/** M-18: can_view_recipe_for applica i blocchi sull'uid passato, non su auth.uid(). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const suffix = Math.random().toString(36).slice(2, 7);

async function createUser(username: string): Promise<string> {
  const r = await pool.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [`${username}@example.test`, JSON.stringify({ username, locale: 'it' })],
  );
  return r.rows[0].id;
}

async function viewAs(role: 'service_role' | 'authenticated', sub: string | null, rid: string, uid: string) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    const r = await c.query('select public.can_view_recipe_for($1, $2) as r', [rid, uid]);
    return r.rows[0].r as boolean;
  } finally {
    await c.query('rollback');
    c.release();
  }
}

d('can_view_recipe_for: blocchi', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  for (const ownerBlocks of [true, false]) {
    it(`false con blocco (${ownerBlocks ? 'owner blocca uid' : 'uid blocca owner'}) da service_role`, async () => {
      const owner = await createUser(`cvo_${suffix}_${ownerBlocks}`);
      const uid = await createUser(`cvu_${suffix}_${ownerBlocks}`);
      const rid = (await pool.query("insert into public.recipes (owner_id, title, visibility) values ($1, 'R', 'public') returning id", [owner])).rows[0].id;
      expect(await viewAs('service_role', null, rid, uid)).toBe(true);
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query('set local session_replication_role = replica');
        const [a, b] = ownerBlocks ? [owner, uid] : [uid, owner];
        await c.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [a, b]);
        await c.query('commit');
      } finally {
        c.release();
      }
      expect(await viewAs('service_role', null, rid, uid)).toBe(false);
      // stesso risultato con auth.uid() di un altro utente
      const other = await createUser(`cvx_${suffix}_${ownerBlocks}`);
      expect(await viewAs('service_role', other, rid, uid)).toBe(false);
      // il proprietario vede sempre la propria ricetta
      expect(await viewAs('service_role', null, rid, owner)).toBe(true);
    });
  }
});
