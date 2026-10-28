/**
 * Test della funzione atomica consume_ai_quota, contro un PostgreSQL reale
 * (vedi scripts/test-db-local.sh). Include il caso di richieste concorrenti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;

async function asRole<T = Record<string, unknown>>(role: string, uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
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

// La funzione e' eseguibile solo dal service role (C-20).
async function consume(uid: string | null, group: string, limit: number, role = 'service_role'): Promise<boolean> {
  const rows = await asRole<{ ok: boolean }>(role, null, 'select public.consume_ai_quota($1, $2, $3, $4, $5) as ok', [uid, group, limit, 'test', 'openai']);
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

  it('non è eseguibile da authenticated e anon (limite non falsificabile dal client)', async () => {
    await expect(consume(alice, 'text', 1000, 'authenticated')).rejects.toThrow(/permission denied/);
    await expect(consume(alice, 'text', 1000, 'anon')).rejects.toThrow(/permission denied/);
  });

  it('refund_ai_quota: non eseguibile da authenticated e anon', async () => {
    const sql = 'select public.refund_ai_quota($1, $2, $3) as ok';
    await expect(asRole('authenticated', alice, sql, [alice, 'text', 'test'])).rejects.toThrow(/permission denied/);
    await expect(asRole('anon', null, sql, [alice, 'text', 'test'])).rejects.toThrow(/permission denied/);
  });

  it('refund_ai_quota (service role) rimuove una sola riga, solo dell\'utente indicato', async () => {
    const uid = await createUser(`quota_r_${Math.random().toString(36).slice(2, 8)}`);
    expect(await consume(uid, 'image', 5)).toBe(true);
    expect(await consume(uid, 'image', 5)).toBe(true);
    expect(await consume(bob, 'image', 5)).toBe(true);
    const refund = async (u: string | null, a = 'test') =>
      (await asRole<{ ok: boolean }>('service_role', null, 'select public.refund_ai_quota($1, $2, $3) as ok', [u, 'image', a]))[0].ok;
    expect(await refund(uid, 'altra_azione')).toBe(false);
    expect(await refund(uid)).toBe(true);
    expect(await usedCount(uid, 'image')).toBe(1);
    expect(await usedCount(bob, 'image')).toBe(1);
    expect(await refund(uid)).toBe(true);
    expect(await refund(uid)).toBe(false);
    await expect(refund(null)).rejects.toThrow();
  });

  it('quantita (C-02): consumo atomico di N unita e rimborso di N righe', async () => {
    const uid = await createUser(`quota_q_${Math.random().toString(36).slice(2, 8)}`);
    const q = async (args: unknown[], sql: string) => (await asRole<{ ok: boolean }>('service_role', null, sql, args))[0].ok;
    const take = (n: number, limit: number) =>
      q([uid, 'vision', limit, 'test', 'openai', n], 'select public.consume_ai_quota($1, $2, $3, $4, $5, $6) as ok');
    expect(await take(8, 10)).toBe(true);
    expect(await usedCount(uid, 'vision')).toBe(8);
    expect(await take(3, 10)).toBe(false); // 8 + 3 > 10: nessuna riga scritta
    expect(await usedCount(uid, 'vision')).toBe(8);
    expect(await q([uid, 'vision', 'test', 8], 'select public.refund_ai_quota($1, $2, $3, $4) as ok')).toBe(true);
    expect(await usedCount(uid, 'vision')).toBe(0);
  });

  it('richiede un utente e rifiuta gruppi non validi', async () => {
    await expect(consume(null, 'text', 5)).rejects.toThrow();
    await expect(consume(alice, 'bogus', 5)).rejects.toThrow();
  });
});
