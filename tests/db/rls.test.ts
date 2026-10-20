/**
 * Row Level Security tests, executed against a real PostgreSQL instance
 * with the migrations applied (see scripts/test-db-local.sh).
 * Each query runs as the `authenticated` role with a simulated JWT `sub`,
 * exactly like PostgREST does in Supabase.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;

async function as<T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
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

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function createUser(username: string): Promise<string> {
  const rows = await admin<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${username}@example.test`, JSON.stringify({ username, locale: 'it' })],
  );
  return rows[0].id;
}

async function createRecipe(uid: string, fields: Record<string, unknown> = {}): Promise<string> {
  const cols = ['owner_id', 'title', ...Object.keys(fields)];
  const vals = [uid, (fields.title as string) ?? 'Ricetta', ...Object.values(fields)];
  if ('title' in fields) {
    cols.splice(cols.indexOf('title', 2), 1);
    vals.splice(2 + Object.keys(fields).indexOf('title'), 1);
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as<{ id: string }>(
    uid,
    `insert into public.recipes (${cols.join(', ')}) values (${placeholders}) returning id`,
    vals,
  );
  return rows[0].id;
}

d('RLS & data rules', () => {
  let alice: string;
  let bob: string;
  let carol: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    const suffix = Math.random().toString(36).slice(2, 7);
    alice = await createUser(`alice_${suffix}`);
    bob = await createUser(`bob_${suffix}`);
    carol = await createUser(`carol_${suffix}`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates a profile and a default shopping list at signup', async () => {
    const p = await as(alice, 'select username, locale from public.my_profile()');
    expect(p).toHaveLength(1);
    const lists = await as(alice, 'select name from public.shopping_lists');
    expect(lists.map((l) => l.name)).toContain('default');
  });

  it('new recipes are PRIVATE by default and invisible to other users', async () => {
    const id = await createRecipe(alice, { title: 'Segreto di famiglia' });
    const own = await as<{ visibility: string }>(alice, 'select visibility from public.recipes where id = $1', [id]);
    expect(own[0].visibility).toBe('private');
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    expect(await as(null, 'select id from public.recipes where id = $1', [id]).catch(() => [])).toHaveLength(0);
  });

  it('other users cannot update or delete a recipe they do not own', async () => {
    const id = await createRecipe(alice, { visibility: 'public' });
    const upd = await as(bob, "update public.recipes set title = 'hacked' where id = $1 returning id", [id]);
    expect(upd).toHaveLength(0);
    const del = await as(bob, 'delete from public.recipes where id = $1 returning id', [id]);
    expect(del).toHaveLength(0);
    const still = await admin<{ title: string }>('select title from public.recipes where id = $1', [id]);
    expect(still[0].title).toBe('Ricetta');
  });

  it('anon role has no table access at all', async () => {
    await expect(as(null, 'select * from public.recipes')).rejects.toThrow(/permission denied/);
  });

  it('public recipes are visible to any authenticated user', async () => {
    const id = await createRecipe(alice, { visibility: 'public', title: 'Pubblica' });
    expect(await as(carol, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
  });

  it('friends-only recipes require an ACCEPTED friendship', async () => {
    const id = await createRecipe(alice, { visibility: 'friends' });
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);

    const fr = await as<{ id: string }>(
      bob,
      'insert into public.friendships (requester_id, addressee_id) values ($1, $2) returning id',
      [bob, alice],
    );
    // pending is not enough
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    // the requester cannot accept their own request (RLS filters the row: 0 rows updated)
    const selfAccept = await as(bob, "update public.friendships set status = 'accepted' where id = $1 returning id", [fr[0].id]);
    expect(selfAccept).toHaveLength(0);
    const [stillPending] = await admin<{ status: string }>('select status from public.friendships where id = $1', [fr[0].id]);
    expect(stillPending.status).toBe('pending');
    // a requester cannot create an already-accepted friendship
    await expect(
      as(carol, "insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [carol, alice]),
    ).rejects.toThrow();

    await as(alice, "update public.friendships set status = 'accepted' where id = $1", [fr[0].id]);
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
    // carol is not a friend
    expect(await as(carol, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);

    // removing the friendship revokes access
    await as(bob, 'delete from public.friendships where id = $1', [fr[0].id]);
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
  });

  it('blocking hides public content in both directions and removes friendships', async () => {
    const id = await createRecipe(carol, { visibility: 'public' });
    await as(carol, 'insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [carol, bob]);
    await as(bob, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [bob, carol]);
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    const fr = await admin(
      'select 1 from public.friendships where least(requester_id, addressee_id) = least($1::uuid, $2::uuid) and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)',
      [bob, carol],
    );
    expect(fr).toHaveLength(0);
    const bobRecipe = await createRecipe(bob, { visibility: 'public' });
    expect(await as(carol, 'select id from public.recipes where id = $1', [bobRecipe])).toHaveLength(0);
    // a blocked user cannot send a friend request
    await expect(
      as(carol, 'insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [carol, bob]),
    ).rejects.toThrow();
    await as(bob, 'delete from public.blocks where blocker_id = $1 and blocked_id = $2', [bob, carol]);
  });

  it('private images cannot be read through storage, even with the exact path', async () => {
    const rid = await createRecipe(alice, {});
    const path = `${alice}/${rid}/photo.webp`;
    await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [path, alice]);
    await as(alice, 'insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3)', [rid, alice, path]);

    expect(await as(alice, 'select name from storage.objects where name = $1', [path])).toHaveLength(1);
    expect(await as(bob, 'select name from storage.objects where name = $1', [path])).toHaveLength(0);
    expect(await as(bob, 'select id from public.recipe_images where recipe_id = $1', [rid])).toHaveLength(0);

    await as(alice, "update public.recipes set visibility = 'public' where id = $1", [rid]);
    expect(await as(bob, 'select name from storage.objects where name = $1', [path])).toHaveLength(1);

    await as(alice, "update public.recipes set visibility = 'private' where id = $1", [rid]);
    expect(await as(bob, 'select name from storage.objects where name = $1', [path])).toHaveLength(0);
  });

  it('imported third-party images stay visible only to the owner, even on public recipes', async () => {
    const rid = await createRecipe(alice, { visibility: 'public' });
    const path = `${alice}/${rid}/imported.webp`;
    await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [path, alice]);
    await as(alice, "insert into public.recipe_images (recipe_id, owner_id, storage_path, kind) values ($1, $2, $3, 'imported')", [rid, alice, path]);
    expect(await as(bob, 'select id from public.recipe_images where recipe_id = $1', [rid])).toHaveLength(0);
    expect(await as(bob, 'select name from storage.objects where name = $1', [path])).toHaveLength(0);
  });

  it('users cannot write into another user storage folder or attach images to others recipes', async () => {
    const rid = await createRecipe(alice, {});
    await expect(
      as(bob, "insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [`${alice}/${rid}/x.webp`, bob]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(bob, 'insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3)', [rid, bob, `${bob}/${rid}/x.webp`]),
    ).rejects.toThrow(/row-level security/);
  });

  it('authenticated users cannot write to the image bucket directly (uploads are server-only)', async () => {
    const rid = await createRecipe(alice, {});
    await expect(
      as(alice, "insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [`${alice}/${rid}/own.webp`, alice]),
    ).rejects.toThrow(/row-level security/);
    await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [`${alice}/${rid}/srv.webp`, alice]);
    const upd = await as(alice, "update storage.objects set name = $1 where name = $2 returning name", [`${alice}/${rid}/x.webp`, `${alice}/${rid}/srv.webp`]);
    expect(upd).toHaveLength(0);
  });

  it('image bucket enforces size and MIME limits', async () => {
    const rows = await admin<{ file_size_limit: number; allowed_mime_types: string[] }>(
      "select file_size_limit::int as file_size_limit, allowed_mime_types from storage.buckets where id = 'recipe-images'",
    );
    expect(rows[0].file_size_limit).toBe(5242880);
    expect([...rows[0].allowed_mime_types].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('recipe_images updates cannot repoint the file or move the image to another recipe', async () => {
    const ridA = await createRecipe(alice, {});
    const ridA2 = await createRecipe(alice, {});
    const ridB = await createRecipe(bob, { visibility: 'public' });
    const pathA = `${alice}/${ridA}/u.webp`;
    const pathB = `${bob}/${ridB}/u.webp`;
    await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [pathA, alice]);
    await admin("insert into storage.objects (bucket_id, name, owner) values ('recipe-images', $1, $2)", [pathB, bob]);
    const [img] = await as<{ id: string }>(
      alice,
      'insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3) returning id',
      [ridA, alice, pathA],
    );
    await as(bob, 'insert into public.recipe_images (recipe_id, owner_id, storage_path) values ($1, $2, $3)', [ridB, bob, pathB]);

    // puntare al file di un altro
    await expect(as(alice, 'update public.recipe_images set storage_path = $2 where id = $1', [img.id, pathB])).rejects.toThrow();
    await expect(as(alice, 'update public.recipe_images set thumb_path = $2 where id = $1', [img.id, pathB])).rejects.toThrow();
    // agganciare la foto alla ricetta altrui
    await expect(as(alice, 'update public.recipe_images set recipe_id = $2 where id = $1', [img.id, ridB])).rejects.toThrow();
    // anche tra ricette proprie il recipe_id è immutabile
    await expect(as(alice, 'update public.recipe_images set recipe_id = $2 where id = $1', [img.id, ridA2])).rejects.toThrow(/immutable/);
    // cambiare owner non ha effetto
    await as(alice, 'update public.recipe_images set owner_id = $2 where id = $1', [img.id, bob]);
    const [row] = await admin<{ owner_id: string; storage_path: string; recipe_id: string }>(
      'select owner_id, storage_path, recipe_id from public.recipe_images where id = $1',
      [img.id],
    );
    expect(row).toEqual({ owner_id: alice, storage_path: pathA, recipe_id: ridA });
    // bob non può modificare la riga di alice
    expect(await as(bob, "update public.recipe_images set alt_text = 'x' where id = $1 returning id", [img.id])).toHaveLength(0);
    // le modifiche legittime restano permesse
    await as(alice, "update public.recipe_images set alt_text = 'ok', position = 2 where id = $1", [img.id]);
  });

  it('API keys are never readable by clients; only metadata of own keys', async () => {
    await admin(
      "insert into public.user_api_keys (user_id, provider, ciphertext, iv, auth_tag, key_hint) values ($1, 'openai', 'c', 'i', 't', '…abcd')",
      [alice],
    );
    await expect(as(alice, 'select * from public.user_api_keys')).rejects.toThrow(/permission denied/);
    await expect(as(bob, 'select ciphertext from public.user_api_keys')).rejects.toThrow(/permission denied/);
    const mine = await as<{ provider: string; key_hint: string }>(alice, 'select * from public.my_api_keys()');
    expect(mine).toEqual([expect.objectContaining({ provider: 'openai', key_hint: '…abcd' })]);
    expect(Object.keys(mine[0])).not.toContain('ciphertext');
    expect(await as(bob, 'select * from public.my_api_keys()')).toHaveLength(0);
  });

  it('translations and AI usage cannot be forged by clients', async () => {
    const rid = await createRecipe(alice, { visibility: 'public' });
    await expect(
      as(bob, "insert into public.recipe_translations (recipe_id, locale, content, source_hash, provider) values ($1, 'en', '{}', 'x', 'fake')", [rid]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(bob, "insert into public.ai_usage (user_id, action, provider, key_source) values ($1, 'x', 'y', 'app')", [bob]),
    ).rejects.toThrow(/permission denied/);
  });

  it('rate limit function is not callable by clients', async () => {
    await expect(as(alice, "select public.rate_limit_hit('x', 1, 60)")).rejects.toThrow(/permission denied/);
    const r1 = await admin<{ ok: boolean }>("select public.rate_limit_hit('test:bucket', 2, 60) as ok");
    const r2 = await admin<{ ok: boolean }>("select public.rate_limit_hit('test:bucket', 2, 60) as ok");
    const r3 = await admin<{ ok: boolean }>("select public.rate_limit_hit('test:bucket', 2, 60) as ok");
    expect([r1[0].ok, r2[0].ok, r3[0].ok]).toEqual([true, true, false]);
  });

  it('attribution cannot be forged when copying recipes', async () => {
    const priv = await createRecipe(alice, { title: 'Privata' });
    const pub = await createRecipe(alice, { title: 'Pubblica', visibility: 'public' });
    // claim alice authored something without a source
    await expect(createRecipe(bob, { original_author_id: alice })).rejects.toThrow(/copied_from/);
    // copy a private recipe of someone else
    await expect(
      createRecipe(bob, { copied_from_recipe_id: priv, original_author_id: alice, source_type: 'copy' }),
    ).rejects.toThrow();
    // wrong author on a visible recipe
    await expect(
      createRecipe(bob, { copied_from_recipe_id: pub, original_author_id: carol, source_type: 'copy' }),
    ).rejects.toThrow(/attribution/);
    // legitimate copy
    const copy = await createRecipe(bob, { copied_from_recipe_id: pub, original_author_id: alice, source_type: 'copy' });
    const rows = await as<{ visibility: string; original_author_id: string }>(
      bob, 'select visibility, original_author_id from public.recipes where id = $1', [copy],
    );
    expect(rows[0]).toEqual({ visibility: 'private', original_author_id: alice });
    // attribution is immutable afterwards
    await as(bob, 'update public.recipes set original_author_id = $2 where id = $1', [copy, bob]);
    const after = await admin<{ original_author_id: string }>('select original_author_id from public.recipes where id = $1', [copy]);
    expect(after[0].original_author_id).toBe(alice);
  });

  it('keeps an ordered version history; the original is always version 1', async () => {
    const id = await createRecipe(alice, { title: 'Ragù', last_change_source: 'import' });
    await as(alice, "update public.recipes set visibility = 'friends' where id = $1", [id]);
    let versions = await as<{ version: number }>(alice, 'select version from public.recipe_versions where recipe_id = $1', [id]);
    expect(versions).toHaveLength(1); // visibility is not a content change

    await as(alice, "update public.recipes set title = 'Ragù napoletano', last_change_source = 'ai_suggestions', last_change_note = '2 suggerimenti' where id = $1", [id]);
    await as(alice, "update public.recipes set description = 'Domenicale' where id = $1", [id]);
    versions = await as(alice, 'select version, change_source, change_note, snapshot->>\'title\' as title from public.recipe_versions where recipe_id = $1 order by version', [id]);
    expect(versions).toEqual([
      expect.objectContaining({ version: 1, change_source: 'import', title: 'Ragù' }),
      expect.objectContaining({ version: 2, change_source: 'ai_suggestions', change_note: '2 suggerimenti', title: 'Ragù napoletano' }),
      expect.objectContaining({ version: 3, change_source: 'edit' }),
    ]);
    // history is private to the owner, and not writable
    await as(alice, "update public.recipes set visibility = 'public' where id = $1", [id]);
    expect(await as(bob, 'select 1 from public.recipe_versions where recipe_id = $1', [id])).toHaveLength(0);
    await expect(
      as(alice, "insert into public.recipe_versions (recipe_id, version, snapshot, change_source) values ($1, 99, '{}', 'edit')", [id]),
    ).rejects.toThrow(/permission denied/);
  });

  it('content hash changes with content (translation invalidation)', async () => {
    const id = await createRecipe(alice, { title: 'Hash' });
    const [a] = await admin<{ content_hash: string }>('select content_hash from public.recipes where id = $1', [id]);
    await as(alice, "update public.recipes set visibility = 'public' where id = $1", [id]);
    const [b] = await admin<{ content_hash: string }>('select content_hash from public.recipes where id = $1', [id]);
    await as(alice, `update public.recipes set steps = '[{"text":"Mescolare"}]' where id = $1`, [id]);
    const [c] = await admin<{ content_hash: string }>('select content_hash from public.recipes where id = $1', [id]);
    expect(a.content_hash).toBe(b.content_hash);
    expect(c.content_hash).not.toBe(b.content_hash);
  });

  it('owners cannot un-hide moderated content', async () => {
    const id = await createRecipe(alice, { visibility: 'public' });
    await admin('update public.recipes set is_hidden = true where id = $1', [id]);
    await as(alice, 'update public.recipes set is_hidden = false where id = $1', [id]);
    const [r] = await admin<{ is_hidden: boolean }>('select is_hidden from public.recipes where id = $1', [id]);
    expect(r.is_hidden).toBe(true);
    expect(await as(bob, 'select id from public.recipes where id = $1', [id])).toHaveLength(0);
    expect(await as(alice, 'select id from public.recipes where id = $1', [id])).toHaveLength(1);
  });

  it('personal notes, collections, shopping lists and meal plans are owner-only', async () => {
    const rid = await createRecipe(alice, { visibility: 'public' });
    await as(alice, "insert into public.recipe_notes (recipe_id, owner_id, body) values ($1, $2, 'meno sale')", [rid, alice]);
    expect(await as(bob, 'select body from public.recipe_notes where recipe_id = $1', [rid])).toHaveLength(0);

    const [col] = await as<{ id: string }>(alice, "insert into public.collections (owner_id, name) values ($1, 'Da provare') returning id", [alice]);
    expect(await as(bob, 'select id from public.collections where id = $1', [col.id])).toHaveLength(0);
    await expect(
      as(bob, 'insert into public.collection_recipes (collection_id, recipe_id) values ($1, $2)', [col.id, rid]),
    ).rejects.toThrow(/row-level security/);

    const [list] = await as<{ id: string }>(alice, 'select id from public.shopping_lists limit 1');
    await expect(
      as(bob, "insert into public.shopping_items (list_id, owner_id, name) values ($1, $2, 'uova')", [list.id, bob]),
    ).rejects.toThrow(/row-level security/);
    expect(await as(bob, 'select id from public.shopping_items where list_id = $1', [list.id])).toHaveLength(0);

    const priv = await createRecipe(alice, {});
    await expect(
      as(bob, "insert into public.meal_plan_entries (owner_id, plan_date, slot, recipe_id, title) values ($1, current_date, 'dinner', $2, 'x')", [bob, priv]),
    ).rejects.toThrow(/row-level security/);
    await as(bob, "insert into public.meal_plan_entries (owner_id, plan_date, slot, recipe_id, title) values ($1, current_date, 'dinner', $2, 'x')", [bob, rid]);
    expect(await as(alice, 'select id from public.meal_plan_entries where owner_id = $1', [bob])).toHaveLength(0);
  });

  it('favorites require visibility', async () => {
    const priv = await createRecipe(alice, {});
    await expect(as(bob, 'insert into public.favorites (user_id, recipe_id) values ($1, $2)', [bob, priv])).rejects.toThrow();
  });

  it('reports only on visible recipes of other users', async () => {
    const pub = await createRecipe(alice, { visibility: 'public' });
    const priv = await createRecipe(alice, {});
    await as(bob, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [bob, pub]);
    await expect(as(bob, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [bob, priv])).rejects.toThrow();
    await expect(as(alice, "insert into public.reports (reporter_id, recipe_id, reason) values ($1, $2, 'spam')", [alice, pub])).rejects.toThrow();
  });

  it('profile search respects discoverability and blocks', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const dave = await createUser(`dave_${suffix}`);
    const eve = await createUser(`dave_hidden_${suffix}`);
    await as(eve, 'update public.profiles set discoverable = false where id = $1', [eve]);
    let res = await as<{ username: string }>(alice, 'select username from public.search_profiles($1)', ['dave']);
    expect(res.map((r) => r.username)).toContain(`dave_${suffix}`);
    expect(res.map((r) => r.username)).not.toContain(`dave_hidden_${suffix}`);
    await as(dave, 'insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [dave, alice]);
    res = await as(alice, 'select username from public.search_profiles($1)', ['dave']);
    expect(res.map((r) => r.username)).not.toContain(`dave_${suffix}`);
  });

  it('a recipe cannot use another user custom category', async () => {
    const [cat] = await as<{ id: string }>(alice, "insert into public.categories (owner_id, slug, name) values ($1, 'zuppe', 'Zuppe') returning id", [alice]);
    await expect(createRecipe(bob, { category_id: cat.id })).rejects.toThrow(/invalid category/);
    await createRecipe(alice, { category_id: cat.id });
  });
});
