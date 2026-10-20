/**
 * Test della funzione atomica consume_ai_quota, contro un PostgreSQL reale
 * (vedi scripts/test-db-local.sh). Include il caso di richieste concorrenti.
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

async function consume(uid: string | null, group: string, limit: number): Promise<boolean> {
  const rows = await as<{ ok: boolean }>(uid, 'select public.consume_ai_quota($1, $2, $3, $4) as ok', [group, limit, 'test', 'openai']);
  return rows[0].ok;
}

async function createUser(username: string): Promise<string> {
  const r = await pool.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
    `${username}@example.test`,
    JSON.stringify({ username, locale: 'it' }),
  ]);
  return r.rows[0].id;
}

async function usedCount(uid: string, group: string): Promise<number> {
  const r = await pool.query(`select count(*)::int as n from public.ai_usage where user_id = $1 and action like $2`, [uid, `${group}:%`]);
  return r.rows[0].n;
}

d('consume_ai_quota', () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
    const tag = Math.random().toString(36).slice(2, 8);
    alice = await createUser(`quota_a_${tag}`);
    bob = await createUser(`quota_b_${tag}`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('consente fino al limite e poi nega', async () => {
    expect(await consume(alice, 'translate', 2)).toBe(true);
    expect(await consume(alice, 'translate', 2)).toBe(true);
    expect(await consume(alice, 'translate', 2)).toBe(false);
    expect(await usedCount(alice, 'translate')).toBe(2);
  });

  it('i gruppi e gli utenti hanno quote indipendenti', async () => {
    expect(await consume(alice, 'vision', 1)).toBe(true);
    expect(await consume(bob, 'vision', 1)).toBe(true);
    expect(await consume(alice, 'vision', 1)).toBe(false);
  });

  it('con limite 0 non consente nulla e non inserisce', async () => {
    expect(await consume(bob, 'image', 0)).toBe(false);
    expect(await usedCount(bob, 'image')).toBe(0);
  });

  it('richieste concorrenti non superano il limite', async () => {
    const limit = 3;
    const results = await Promise.all(Array.from({ length: 15 }, () => consume(alice, 'text', limit)));
    expect(results.filter(Boolean)).toHaveLength(limit);
    expect(await usedCount(alice, 'text')).toBe(limit);
  });

  it('richiede un utente autenticato e rifiuta gruppi non validi', async () => {
    await expect(consume(null, 'text', 5)).rejects.toThrow();
    await expect(consume(alice, 'bogus', 5)).rejects.toThrow();
  });
});
