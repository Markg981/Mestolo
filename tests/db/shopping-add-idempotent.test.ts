/** add_shopping_items (C-08): atomica e idempotente, su PostgreSQL reale. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

async function as(uid: string, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const admin = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const mkUser = async (name: string) =>
  (await admin('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]))[0].id as string;

const add = (uid: string, list: string, items: unknown[], key: string) =>
  as(uid, 'select public.add_shopping_items($1, $2::jsonb, $3) as r', [list, JSON.stringify(items), key]).then((r) => r[0].r as { added: number; merged: number; duplicate: boolean });

d('db add_shopping_items', () => {
  const s = Math.random().toString(36).slice(2, 7);
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  const setup = async (n: string) => {
    const u = await mkUser(`sa_${n}_${s}`);
    const list = (await admin("insert into public.shopping_lists (owner_id, name) values ($1, 'default') returning id", [u]))[0].id as string;
    return { u, list };
  };
  const rows = (list: string) => admin('select name, quantity, unit from public.shopping_items where list_id = $1 order by name', [list]);

  it('stessa key due volte: nessun duplicato e nessun raddoppio', async () => {
    const { u, list } = await setup('a');
    const items = [{ name: 'Farina', quantity: 100, unit: 'g' }, { name: 'sale', quantity: null, unit: null }];
    const key = randomUUID();
    const first = await add(u, list, items, key);
    expect(first).toMatchObject({ added: 2, merged: 0, duplicate: false });
    const second = await add(u, list, items, key);
    expect(second).toMatchObject({ added: 2, merged: 0, duplicate: true });
    const r = await rows(list);
    expect(r).toHaveLength(2);
    expect(Number(r.find((x) => x.name === 'Farina')!.quantity)).toBe(100);
  });

  it('stessa key con payload diverso: conflitto esplicito, nessuna scrittura', async () => {
    const { u, list } = await setup('c');
    const key = randomUUID();
    await add(u, list, [{ name: 'Farina', quantity: 100, unit: 'g' }], key);
    await expect(add(u, list, [{ name: 'Farina', quantity: 500, unit: 'g' }], key)).rejects.toMatchObject({ code: 'IK409' });
    const r = await rows(list);
    expect(r).toHaveLength(1);
    expect(Number(r[0].quantity)).toBe(100);
  });

  it('stessa key, stesso payload con chiavi in ordine diverso: replay idempotente', async () => {
    const { u, list } = await setup('d');
    const key = randomUUID();
    await add(u, list, [{ name: 'sale', quantity: 1, unit: 'g' }], key);
    expect(await add(u, list, [{ unit: 'g', quantity: 1, name: 'sale' }], key)).toMatchObject({ duplicate: true });
  });

  it('key diverse: merge delle quantita (nome normalizzato + stessa unita)', async () => {
    const { u, list } = await setup('b');
    await add(u, list, [{ name: 'Farina', quantity: 100, unit: 'g' }], randomUUID());
    const res = await add(u, list, [{ name: 'farina', quantity: 50, unit: 'g' }, { name: 'farina', quantity: 1, unit: 'kg' }], randomUUID());
    expect(res).toMatchObject({ added: 1, merged: 1 });
    const r = await rows(list);
    expect(r).toHaveLength(2);
    expect(Number(r.find((x) => x.unit === 'g')!.quantity)).toBe(150);
  });

  it('errore: stato invariato e la key non resta consumata', async () => {
    const { u, list } = await setup('c');
    await add(u, list, [{ name: 'uova', quantity: 2, unit: null }], randomUUID());
    const key = randomUUID();
    // seconda voce non valida (name oltre 200 caratteri): tutta la chiamata fallisce
    await expect(add(u, list, [{ name: 'uova', quantity: 3, unit: null }, { name: 'x'.repeat(201), quantity: 1, unit: null }], key)).rejects.toThrow();
    const r = await rows(list);
    expect(r).toHaveLength(1);
    expect(Number(r[0].quantity)).toBe(2);
    expect(await admin('select 1 from public.shopping_add_requests where user_id = $1 and idempotency_key = $2', [u, key])).toHaveLength(0);
    // il retry con la stessa key ora e valido e si applica una volta sola
    expect(await add(u, list, [{ name: 'uova', quantity: 3, unit: null }], key)).toMatchObject({ merged: 1, duplicate: false });
    expect(Number((await rows(list))[0].quantity)).toBe(5);
  });

  it('lista di un altro utente: rifiutata', async () => {
    const a = await setup('d');
    const b = await mkUser(`sa_e_${s}`);
    await expect(add(b, a.list, [{ name: 'x', quantity: 1, unit: null }], randomUUID())).rejects.toThrow();
    expect(await rows(a.list)).toHaveLength(0);
  });
});
