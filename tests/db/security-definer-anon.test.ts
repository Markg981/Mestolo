/** Hardening SECURITY DEFINER (migration 20261025033000): anon non esegue le funzioni interne. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';

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
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

async function user(name: string) {
  const [r] = await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]);
  return r.id;
}

d('security definer: privilegi EXECUTE', () => {
  let owner: string, other: string, tag: string, cid: string, lid: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    tag = Math.random().toString(36).slice(2, 7);
    owner = await user(`sd_${tag}`);
    other = await user(`sx_${tag}`);
    cid = (await admin<{ id: string }>('insert into public.collections (owner_id, name) values ($1, $2) returning id', [owner, 'c']))[0].id;
    lid = (await admin<{ id: string }>('insert into public.shopping_lists (owner_id, name) values ($1, $2) returning id', [owner, 'l']))[0].id;
  });
  afterAll(async () => pool?.end());

  it('anon non ha EXECUTE su nessuna funzione security definer interna', async () => {
    const rows = await admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
         and p.proname <> all (array['get_public_recipe','list_public_recipe_slugs','count_public_recipes','public_cover_paths','is_public_cover_object','invite_preview','get_profile_card','get_public_recipe_nutrition','resolve_public_recipe_slug'])`,
    );
    expect(rows).toEqual([]);
  });

  it('anon non ha alcun privilegio sulle tabelle public (esistenti e future)', async () => {
    const rows = await admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p','v','m')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
           or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(rows).toEqual([]);
    const defs = await admin<{ defaclacl: string[] }>(
      `select d.defaclacl::text[] as defaclacl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public' and d.defaclobjtype = 'r'`,
    );
    for (const d of defs) expect(d.defaclacl.some((a) => a.startsWith('anon='))).toBe(false);
  });

  it('funzioni security definer eseguibili da authenticated: lista attesa esplicita', async () => {
    const rows = await admin<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1`,
    );
    const got = rows.map((r) => r.proname);
    const expected = JSON.parse(readFileSync(new URL('./security-definer-authenticated.expected.json', import.meta.url), 'utf8')) as string[];
    // Lista esplicita: una nuova funzione security definer esposta ad authenticated va aggiunta qui di proposito.
    expect(got.filter((n) => !expected.includes(n))).toEqual([]);
  });

  it('collection_owner e shopping_list_owner: anon negato', async () => {
    await expect(as(null, 'select public.collection_owner($1)', [cid])).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select public.shopping_list_owner($1)', [lid])).rejects.toThrow(/permission denied/);
  });

  it('un estraneo non scopre il proprietario, il proprietario si', async () => {
    const [a] = await as<{ o: string | null }>(other, 'select public.collection_owner($1) as o', [cid]);
    const [b] = await as<{ o: string | null }>(other, 'select public.shopping_list_owner($1) as o', [lid]);
    expect(a.o).toBeNull();
    expect(b.o).toBeNull();
    const [c] = await as<{ o: string | null }>(owner, 'select public.collection_owner($1) as o', [cid]);
    const [e] = await as<{ o: string | null }>(owner, 'select public.shopping_list_owner($1) as o', [lid]);
    expect(c.o).toBe(owner);
    expect(e.o).toBe(owner);
  });
});
