/** Realtime publication (migration 20261024000001), executed on real PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;

d('realtime publication', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => pool?.end());

  it('contiene le tabelle sincronizzate', async () => {
    const { rows } = await pool.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
    const names = rows.map((r) => r.tablename);
    for (const t of ['shopping_items', 'meal_plan_entries', 'recipes']) expect(names).toContain(t);
    expect(names).not.toContain('favorites');
  });

  it('non espone tabelle sensibili e non cambia la replica identity', async () => {
    const { rows } = await pool.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('user_api_keys', 'ai_usage', 'reports')");
    expect(rows).toEqual([]);
    const ident = await pool.query("select relname, relreplident from pg_class where relname in ('shopping_items', 'recipes') and relkind = 'r'");
    for (const r of ident.rows) expect(r.relreplident).toBe('d');
  });

  // B-06: per i DELETE Realtime NON applica la RLS e invia le colonne della
  // replica identity. Con FULL l'intera riga eliminata sarebbe visibile a chi
  // ascolta; con DEFAULT viaggia solo la chiave primaria. Il client reagisce a
  // ogni evento (event '*') rifacendo il fetch, che passa dalla RLS.
  it('ogni tabella pubblicata in public ha replica identity DEFAULT (solo PK nei DELETE)', async () => {
    const { rows } = await pool.query(
      `select c.relname, c.relreplident
         from pg_publication_tables p
         join pg_class c on c.relname = p.tablename
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect({ table: r.relname, ident: r.relreplident }).toEqual({ table: r.relname, ident: 'd' });
  });
});
