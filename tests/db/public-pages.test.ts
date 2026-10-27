/** Public recipe pages (migration 20261025000001): what an anonymous visitor can and cannot see. */
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
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

async function user(name: string) {
  const [r] = await admin<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${name}@example.test`, JSON.stringify({ username: name })]);
  return r.id;
}

d('public recipe pages', () => {
  let owner: string, other: string, tag: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    tag = Math.random().toString(36).slice(2, 7);
    owner = await user(`pp_${tag}`);
    other = await user(`po_${tag}`);
  });
  afterAll(async () => pool?.end());

  const create = async (title: string, visibility = 'public', enabled = true) =>
    (
      await as<{ id: string; public_slug: string | null }>(
        owner,
        'insert into public.recipes (owner_id, title, visibility, public_page_enabled, ingredients, steps) values ($1, $2, $3, $4, $5, $6) returning id, public_slug',
        [owner, title, visibility, enabled, JSON.stringify([{ name: 'farina', quantity: 1, unit: 'g' }]), JSON.stringify([{ text: 'Mescola' }])],
      )
    )[0];
  const get = (slug: string | null) => as<Record<string, unknown>>(null, 'select * from public.get_public_recipe($1)', [slug]);

  it('anon has no table access: the RLS of recipes is untouched', async () => {
    await expect(as(null, 'select id from public.recipes')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select id from public.profiles')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select id from public.recipe_images')).rejects.toThrow(/permission denied/);
  });

  it('assigns a stable slug from the title and the id, only when the page is enabled', async () => {
    const r = await create('Tiramisù della Nonna');
    expect(r.public_slug).toMatch(/^tiramisu-della-nonna-[a-f0-9]{8}$/);
    // il suffisso non deriva piu' dall'id scelto dal client (anti-squatting)
    expect(r.public_slug).not.toContain(r.id.replaceAll('-', '').slice(0, 8));
    const off = await create('Spenta', 'public', false);
    expect(off.public_slug).toBeNull();
  });

  it('regenerates the slug on rename and keeps the old one resolving (A-28)', async () => {
    const r = await create('Zuppa antica');
    await as(owner, 'update public.recipes set title = $2 where id = $1', [r.id, 'Zuppa rinnovata']);
    const [after] = await admin<{ public_slug: string }>('select public_slug from public.recipes where id = $1', [r.id]);
    expect(after.public_slug).toBe(`zuppa-rinnovata-${r.public_slug!.slice(-8)}`);
    const [res] = await as<{ s: string }>(null, 'select public.resolve_public_recipe_slug($1) as s', [r.public_slug]);
    expect(res.s).toBe(after.public_slug);
    expect(await get(after.public_slug)).toHaveLength(1);
    // renaming back reuses the original slug and drops it from the history
    await as(owner, 'update public.recipes set title = $2 where id = $1', [r.id, 'Zuppa antica']);
    const [back] = await as<{ s: string | null }>(null, 'select public.resolve_public_recipe_slug($1) as s', [r.public_slug]);
    expect(back.s).toBeNull();
    const [mid] = await as<{ s: string }>(null, 'select public.resolve_public_recipe_slug($1) as s', [after.public_slug]);
    expect(mid.s).toBe(r.public_slug);
  });

  it('does not resolve old slugs once the page is no longer public', async () => {
    const r = await create('Prima');
    await as(owner, 'update public.recipes set title = $2 where id = $1', [r.id, 'Dopo']);
    await as(owner, "update public.recipes set visibility = 'private' where id = $1", [r.id]);
    const [res] = await as<{ s: string | null }>(null, 'select public.resolve_public_recipe_slug($1) as s', [r.public_slug]);
    expect(res.s).toBeNull();
  });

  it('matches the TypeScript slug builder', async () => {
    const id = '3f2a9c1e-7b44-4d0a-9d55-0a1b2c3d4e5f';
    const vectors: [string, string][] = [
      ['Tiramisù della nonna', 'tiramisu-della-nonna-3f2a9c1e'],
      ['  Pasta   &  Fagioli!! ', 'pasta-fagioli-3f2a9c1e'],
      ['Crème brûlée', 'creme-brulee-3f2a9c1e'],
      ['Straße', 'strasse-3f2a9c1e'],
      ['!!!', 'ricetta-3f2a9c1e'],
      ['Año nuevo ñoquis', 'ano-nuevo-noquis-3f2a9c1e'],
    ];
    for (const [title, expected] of vectors) {
      const [r] = await admin<{ s: string }>('select public.make_recipe_slug($1, $2) as s', [title, id]);
      expect(r.s).toBe(expected);
    }
  });

  it('un id scelto dal client non permette di prenotare lo slug di un altro', async () => {
    const id = '3f2a9c1e-7b44-4d0a-9d55-0a1b2c3d4e5f';
    const [a] = await as<{ public_slug: string }>(owner, "insert into public.recipes (id, owner_id, title, visibility, public_page_enabled) values ($1, $2, 'Squat', 'public', true) returning public_slug", [id, owner]);
    expect(a.public_slug).not.toBe('squat-3f2a9c1e');
    const b = await create('Squat');
    expect(b.public_slug).not.toBe(a.public_slug);
  });

  it('the slug cannot be chosen or rewritten by the client', async () => {
    const r = await create('Mia');
    await as(owner, "update public.recipes set public_slug = 'hacked' where id = $1", [r.id]);
    const [row] = await admin<{ public_slug: string }>('select public_slug from public.recipes where id = $1', [r.id]);
    expect(row.public_slug).toBe(r.public_slug);
    const [ins] = await as<{ public_slug: string | null }>(owner, "insert into public.recipes (owner_id, title, public_slug) values ($1, 'x', 'squat') returning public_slug", [owner]);
    expect(ins.public_slug).toBeNull();
  });

  it('anon sees a flagged public recipe, with safe columns only', async () => {
    const r = await create('Visibile');
    const rows = await get(r.public_slug);
    expect(rows).toHaveLength(1);
    const cols = Object.keys(rows[0]).sort();
    expect(cols).toEqual(
      [
        'id', 'slug', 'title', 'description', 'original_language', 'servings', 'prep_minutes', 'cook_minutes', 'total_minutes',
        'ingredients', 'steps', 'tags', 'category_slug', 'source_name', 'source_url', 'author_name', 'author_username',
        'cover_image_id', 'cover_alt', 'cover_kind', 'cover_attribution', 'created_at', 'updated_at',
      ].sort(),
    );
    expect(JSON.stringify(rows[0])).not.toContain('example.test');
    expect(rows[0].author_username).toBe(`pp_${tag}`);
  });

  it('anon does not see private, friends-only, unflagged or hidden recipes', async () => {
    const priv = await create('Privata', 'private', true); // il flag viene azzerato
    expect(priv.public_slug).toBeNull();
    const friends = await create('Amici', 'friends', true);
    expect(friends.public_slug).toBeNull();
    const unflagged = await create('Non indicizzabile', 'public', false);
    await admin('update public.recipes set public_slug = $2 where id = $1', [unflagged.id, `manuale-${tag}`]);
    expect(await get(`manuale-${tag}`)).toHaveLength(0);

    const hid = await create('Nascosta');
    expect(await get(hid.public_slug)).toHaveLength(1);
    // la moderazione cambia is_hidden solo con il flag di transazione che impostano le sue funzioni
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('mestolo.moderation', 'on', true)");
      await c.query('update public.recipes set is_hidden = true where id = $1', [hid.id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await get(hid.public_slug)).toHaveLength(0);
  });

  it('a recipe that stops being public loses its page at once', async () => {
    const r = await create('Diventa privata');
    expect(await get(r.public_slug)).toHaveLength(1);
    await as(owner, "update public.recipes set visibility = 'private' where id = $1", [r.id]);
    expect(await get(r.public_slug)).toHaveLength(0);
    const [row] = await admin<{ public_page_enabled: boolean; public_slug: string }>('select public_page_enabled, public_slug from public.recipes where id = $1', [r.id]);
    expect(row.public_page_enabled).toBe(false);
    // riattivandola, l'indirizzo è lo stesso
    await as(owner, "update public.recipes set visibility = 'public', public_page_enabled = true where id = $1", [r.id]);
    expect(await get(r.public_slug)).toHaveLength(1);
  });

  it('una copia non puo essere piu visibile della sorgente (M-02)', async () => {
    const src = await create('Solo amici', 'friends', false);
    const ing = JSON.stringify([{ name: 'farina', quantity: 1, unit: 'g' }]);
    const steps = JSON.stringify([{ text: 'Mescola' }]);
    const [{ owner_id: srcOwner }] = await admin<{ owner_id: string }>('select owner_id from public.recipes where id = $1', [src.id]);
    // la copia e' di "other", che vede la ricetta solo se amico: la inseriamo come service role
    const [copy] = await admin<{ id: string }>(
      "insert into public.recipes (owner_id, title, visibility, ingredients, steps, copied_from_recipe_id, original_author_id) values ($1, 'Copia', 'private', $2, $3, $4, $5) returning id",
      [other, ing, steps, src.id, srcOwner],
    );
    await expect(admin("update public.recipes set visibility = 'public' where id = $1", [copy.id])).rejects.toThrow(/copy_visibility_exceeds_source/);
    await expect(admin("update public.recipes set visibility = 'public', public_page_enabled = true where id = $1", [copy.id])).rejects.toThrow(/copy_visibility_exceeds_source/);
    await admin("update public.recipes set visibility = 'friends' where id = $1", [copy.id]);
    // sorgente pubblica: la copia puo' ampliarsi
    await admin("update public.recipes set visibility = 'public' where id = $1", [src.id]);
    await admin("update public.recipes set visibility = 'public', public_page_enabled = true where id = $1", [copy.id]);
    // sorgente cancellata: la copia diventa autonoma
    await admin('delete from public.recipes where id = $1', [src.id]);
    await admin("update public.recipes set visibility = 'private' where id = $1", [copy.id]);
    await admin("update public.recipes set visibility = 'public' where id = $1", [copy.id]);
  });

  it('only the owner can switch the flag', async () => {
    const r = await create('Mia 2', 'public', false);
    const res = await as(other, 'update public.recipes set public_page_enabled = true where id = $1 returning id', [r.id]);
    expect(res).toHaveLength(0);
  });

  it('the sitemap lists only active pages', async () => {
    const on = await create('In sitemap');
    const off = await create('Fuori sitemap', 'public', false);
    const rows = await as<{ slug: string }>(null, 'select slug from public.list_public_recipe_slugs(0, 5000)');
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain(on.public_slug);
    expect(slugs).not.toContain(off.public_slug);
    const [{ count }] = await as<{ count: string }>(null, 'select public.count_public_recipes() as count');
    expect(Number(count)).toBeGreaterThanOrEqual(1);
    expect(await as(null, 'select * from public.list_public_recipe_slugs(0, 1)')).toHaveLength(1);
  });

  it('only the cover (not imported) of an active page is exposed to anon', async () => {
    const r = await create('Con foto');
    const path = (n: string) => `${owner}/${tag}-${n}.webp`;
    const img = async (n: string, kind: string, position: number) =>
      (
        await admin<{ id: string }>(
          'insert into public.recipe_images (recipe_id, owner_id, storage_path, thumb_path, kind, position) values ($1, $2, $3, $4, $5, $6) returning id',
          [r.id, owner, path(n), path(`${n}-t`), kind, position],
        )
      )[0].id;
    const imported = await img('imp', 'imported', 0);
    const cover = await img('cov', 'upload', 1);
    const second = await img('sec', 'upload', 2);

    const [row] = await get(r.public_slug);
    expect(row.cover_image_id).toBe(cover);

    expect(await as(null, 'select * from public.public_cover_paths($1)', [cover])).toHaveLength(1);
    expect(await as(null, 'select * from public.public_cover_paths($1)', [imported])).toHaveLength(0);
    expect(await as(null, 'select * from public.public_cover_paths($1)', [second])).toHaveLength(0);
    expect((await as<{ ok: boolean }>(null, 'select public.is_public_cover_object($1) as ok', [path('cov-t')]))[0].ok).toBe(true);
    expect((await as<{ ok: boolean }>(null, 'select public.is_public_cover_object($1) as ok', [path('sec')]))[0].ok).toBe(false);
    expect((await as<{ ok: boolean }>(null, 'select public.is_public_cover_object($1) as ok', [path('imp')]))[0].ok).toBe(false);

    await as(owner, 'update public.recipes set public_page_enabled = false where id = $1', [r.id]);
    expect(await as(null, 'select * from public.public_cover_paths($1)', [cover])).toHaveLength(0);
    expect((await as<{ ok: boolean }>(null, 'select public.is_public_cover_object($1) as ok', [path('cov')]))[0].ok).toBe(false);
  });

  it('the author is hidden when the profile is not discoverable', async () => {
    await admin('update public.profiles set discoverable = false where id = $1', [owner]);
    try {
      const r = await create('Autore nascosto');
      const [row] = await get(r.public_slug);
      expect(row.author_username).toBeNull();
      expect(row.author_name).toBeNull();
    } finally {
      await admin('update public.profiles set discoverable = true where id = $1', [owner]);
    }
  });
});
