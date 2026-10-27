/** Rete di sicurezza (audit A-09): ogni tabella di public deve avere la RLS attiva. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

d('RLS attiva su tutte le tabelle di public', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('nessuna tabella di public ha relrowsecurity = false', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and not c.relispartition
          and not c.relrowsecurity
        order by c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('enumera almeno una tabella (il test non e vuoto)', async () => {
    const { rows } = await pool.query("select count(*)::int as n from pg_tables where schemaname = 'public'");
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
