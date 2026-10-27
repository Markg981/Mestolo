/** L-15 (migration 20261121000008): enforce_row_cap serializza gli INSERT concorrenti con un advisory lock. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

d('db row cap concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('drop table if exists public.l15_cap_probe');
    await pool.query('create table public.l15_cap_probe (id uuid primary key default gen_random_uuid(), owner_id uuid not null)');
    await pool.query(
      "create trigger l15_cap before insert on public.l15_cap_probe for each row execute function public.enforce_row_cap(1, 'owner_id')",
    );
  });
  afterAll(async () => {
    await pool?.query('drop table if exists public.l15_cap_probe');
    await pool?.end();
  });

  it('two concurrent inserts for the same owner: only one passes a cap of 1', async () => {
    const owner = '00000000-0000-0000-0000-0000000000a1';
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('begin');
      await c2.query('begin');
      await c1.query('insert into public.l15_cap_probe (owner_id) values ($1)', [owner]);
      // c2 si blocca sul lock finche' c1 non fa commit, poi vede la riga e supera il tetto.
      const second = c2.query('insert into public.l15_cap_probe (owner_id) values ($1)', [owner]);
      const settled = second.then(() => null, (e: { code?: string }) => e);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query('commit');
      const err = await settled;
      expect(err?.code).toBe('54000');
      await c2.query('rollback');
    } finally {
      c1.release();
      c2.release();
    }
    const n = (await pool.query('select count(*)::int as n from public.l15_cap_probe where owner_id = $1', [owner])).rows[0].n;
    expect(n).toBe(1);
  });

  it('different owners do not block each other', async () => {
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('begin');
      await c2.query('begin');
      await c1.query('insert into public.l15_cap_probe (owner_id) values ($1)', ['00000000-0000-0000-0000-0000000000b1']);
      await c2.query('insert into public.l15_cap_probe (owner_id) values ($1)', ['00000000-0000-0000-0000-0000000000b2']);
      await c1.query('commit');
      await c2.query('commit');
    } finally {
      c1.release();
      c2.release();
    }
  });
});
