import 'server-only';
import { createClient, getUser } from '@/lib/supabase/server';
import type { CategoryRow } from '@/lib/recipes/categories';
import type { RecipeRow } from '@/lib/recipes/types';
import { PAGE_SIZE, applyKeyset, decodeCursor, toPage, type Cursor, type KeysetSort, type Page } from '@/lib/pagination';
import { buildSearchRpcParams } from '@/lib/recipes/search-params';

/** All reads go through the user's client: RLS decides what is visible. */

export const LIST_COLUMNS =
  'id, owner_id, title, description, original_language, servings, prep_minutes, cook_minutes, total_minutes, category_id, tags, visibility, verification_status, source_type, source_name, created_at, updated_at, original_author_name, is_hidden, rating_avg, rating_count';

export type RecipeListItem = Pick<
  RecipeRow,
  | 'id' | 'owner_id' | 'title' | 'description' | 'original_language' | 'servings' | 'prep_minutes' | 'cook_minutes' | 'total_minutes'
  | 'category_id' | 'tags' | 'visibility' | 'verification_status' | 'source_type' | 'source_name' | 'created_at' | 'updated_at' | 'original_author_name' | 'is_hidden' | 'rating_avg' | 'rating_count'
> & { coverImageId: string | null; coverKind: string | null; ownerUsername?: string | null };

export interface ImageRow {
  id: string;
  recipe_id: string;
  owner_id: string;
  kind: 'upload' | 'imported' | 'ai_generated';
  source_url: string | null;
  attribution: string | null;
  alt_text: string;
  width: number | null;
  height: number | null;
  position: number;
}

/**
 * Un errore del DB non deve diventare uno stato vuoto: lo rilanciamo cosi' che
 * error.tsx lo mostri e Sentry lo registri.
 */
function assertNoError(error: { message: string } | null | undefined, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function listCategories(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const user = await getUser();
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, owner_id, name, sort_order')
    .or(`owner_id.is.null${user ? `,owner_id.eq.${user.id}` : ''}`)
    .order('sort_order')
    .order('name');
  assertNoError(error, 'listCategories');
  return (data as CategoryRow[]) ?? [];
}

export async function attachCovers<T extends { id: string; owner_id: string }>(rows: T[]): Promise<(T & { coverImageId: string | null; coverKind: string | null })[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('recipe_images')
    .select('id, recipe_id, kind, position')
    .in('recipe_id', rows.map((r) => r.id))
    .order('position');
  assertNoError(error, 'attachCovers');
  const first = new Map<string, { id: string; kind: string }>();
  for (const img of (data as { id: string; recipe_id: string; kind: string }[]) ?? []) {
    if (!first.has(img.recipe_id)) first.set(img.recipe_id, { id: img.id, kind: img.kind });
  }
  return rows.map((r) => ({ ...r, coverImageId: first.get(r.id)?.id ?? null, coverKind: first.get(r.id)?.kind ?? null }));
}

export interface RecipeFilters {
  q?: string;
  category?: string;
  tag?: string;
  sort?: 'recent' | 'updated' | 'title' | 'quick';
  favorites?: boolean;
  review?: boolean;
  limit?: number;
}

/** Validates raw query-string values into filters (shared by the page and the "load more" action). */
export function parseRecipeFilters(sp: { q?: string; category?: string; sort?: string; fav?: string; review?: string; tag?: string }): RecipeFilters {
  return {
    q: sp.q?.slice(0, 100),
    category: sp.category && /^[0-9a-f-]{36}$/i.test(sp.category) ? sp.category : undefined,
    sort: (['recent', 'updated', 'title', 'quick'] as const).find((s) => s === sp.sort) ?? 'recent',
    favorites: sp.fav === '1',
    review: sp.review === '1',
    tag: sp.tag?.slice(0, 40),
  };
}

function keysetSortFor(sort: RecipeFilters['sort']): KeysetSort {
  switch (sort) {
    case 'title':
      return { column: 'title', ascending: true };
    case 'updated':
      return { column: 'updated_at', ascending: false };
    case 'quick':
      return { column: 'total_minutes', ascending: true, nullable: true };
    default:
      return { column: 'created_at', ascending: false };
  }
}

async function buildMyRecipesQuery(f: RecipeFilters, userId: string, limit: number, cursor: Cursor | null = null) {
  const supabase = await createClient();
  // With a text query the search goes through the search_recipes RPC (full-text + trigram,
  // security invoker so RLS still applies). The RPC itself applies sort, favourites, filters and the
  // keyset cursor BEFORE its row cap (200): doing it afterwards in PostgREST would act on a truncated set.
  // Without a text query, favourites are filtered DB-side with an inner embed on favorites (RLS limits it to
  // the user's own rows); the embed is stripped by stripFavEmbed.
  const cols = f.favorites && !f.q ? `${LIST_COLUMNS}, favorites!inner(user_id)` : LIST_COLUMNS;
  // favourites may include recipes of other people: no owner filter in that case
  const owner = f.favorites ? null : userId;
  let query = f.q
    ? supabase.rpc('search_recipes', buildSearchRpcParams({ ...f, q: f.q, owner, limit, cursor })).select(cols)
    : f.favorites
      ? supabase.from('recipes').select(cols).eq('favorites.user_id', userId)
      : supabase.from('recipes').select(cols).eq('owner_id', userId);

  if (f.category) query = query.eq('category_id', f.category);
  if (f.tag) query = query.contains('tags', [f.tag]);
  if (f.review) query = query.eq('verification_status', 'needs_review');
  // wrapped: a bare query builder is thenable and would be executed by the `await` of the async function
  return { query };
}

function stripFavEmbed<T>(rows: T[] | null): T[] {
  return (rows ?? []).map((r) => {
    const rest = { ...(r as T & { favorites?: unknown }) };
    delete rest.favorites;
    return rest as T;
  });
}

/** First N recipes of the user (home page widgets). */
export async function listMyRecipes(f: RecipeFilters = {}): Promise<RecipeListItem[]> {
  const user = await getUser();
  if (!user) return [];
  const { query } = await buildMyRecipesQuery(f, user.id, f.limit ?? 120);
  const sort = keysetSortFor(f.sort);
  const { data, error } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order('id', { ascending: sort.ascending }).limit(f.limit ?? 120);
  assertNoError(error, 'listMyRecipes');
  return attachCovers(stripFavEmbed(data as RecipeListItem[] | null));
}

/** One page of the user's recipes, keyset-paginated on the chosen sort (+ id as tie-breaker). */
export async function listMyRecipesPage(f: RecipeFilters = {}, cursor?: string | null): Promise<Page<RecipeListItem>> {
  const user = await getUser();
  if (!user) return { items: [], nextCursor: null };
  const sort = keysetSortFor(f.sort);
  const pageSize = f.limit ?? PAGE_SIZE;
  const decoded = decodeCursor(cursor);
  const { query } = await buildMyRecipesQuery(f, user.id, pageSize + 1, decoded);
  const { data, error } = await applyKeyset(query, sort, decoded, pageSize);
  assertNoError(error, 'listMyRecipesPage');
  const page = toPage(stripFavEmbed(data as RecipeListItem[] | null), sort, pageSize);
  return { items: await attachCovers(page.items), nextCursor: page.nextCursor };
}

export interface RecipeDetail {
  recipe: RecipeRow;
  images: ImageRow[];
  category: CategoryRow | null;
  owner: { id: string; username: string; display_name: string } | null;
  isOwner: boolean;
  isFavorite: boolean;
  note: string;
  collectionIds: string[];
}

export async function getRecipeDetail(id: string): Promise<RecipeDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: recipe, error: recipeError } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle();
  assertNoError(recipeError, 'getRecipeDetail');
  if (!recipe) return null;
  const r = recipe as RecipeRow;
  const [images, category, owner, fav, note, cols] = await Promise.all([
    supabase.from('recipe_images').select('id, recipe_id, owner_id, kind, source_url, attribution, alt_text, width, height, position').eq('recipe_id', id).order('position'),
    r.category_id ? supabase.from('categories').select('id, slug, owner_id, name, sort_order').eq('id', r.category_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('profiles').select('id, username, display_name').eq('id', r.owner_id).maybeSingle(),
    supabase.from('favorites').select('recipe_id').eq('user_id', user.id).eq('recipe_id', id).maybeSingle(),
    supabase.from('recipe_notes').select('body').eq('recipe_id', id).eq('owner_id', user.id).maybeSingle(),
    supabase.from('collection_recipes').select('collection_id').eq('recipe_id', id),
  ]);
  assertNoError(images.error ?? owner.error ?? fav.error ?? note.error ?? cols.error, 'getRecipeDetail');
  return {
    recipe: r,
    images: (images.data as ImageRow[]) ?? [],
    category: (category.data as CategoryRow) ?? null,
    owner: owner.data ?? null,
    isOwner: r.owner_id === user.id,
    isFavorite: !!fav.data,
    note: (note.data as { body: string } | null)?.body ?? '',
    collectionIds: ((cols.data as { collection_id: string }[]) ?? []).map((c) => c.collection_id),
  };
}

export async function listCollections() {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, description, updated_at, collection_recipes(count)')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });
  assertNoError(error, 'listCollections');
  return ((data ?? []) as { id: string; name: string; description: string; updated_at: string; collection_recipes: { count: number }[] }[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    count: c.collection_recipes?.[0]?.count ?? 0,
  }));
}

/** Collections the user can add recipes to: own ones plus those where they are co-editor. */
export async function listEditableCollections() {
  const own = await listCollections();
  const user = await getUser();
  if (!user) return own;
  const supabase = await createClient();
  const { data: mem, error: memError } = await supabase.from('collection_members').select('collection_id').eq('user_id', user.id).eq('role', 'editor');
  assertNoError(memError, 'listEditableCollections');
  const ids = ((mem ?? []) as { collection_id: string }[]).map((m) => m.collection_id);
  if (!ids.length) return own;
  const { data, error } = await supabase.from('collections').select('id, name, description').in('id', ids);
  assertNoError(error, 'listEditableCollections');
  const extra = ((data ?? []) as { id: string; name: string; description: string }[]).map((c) => ({ ...c, count: 0 }));
  return [...own, ...extra];
}

export type SharedCollection = { id: string; name: string; description: string; count: number; role: 'viewer' | 'editor'; ownerName: string };

/** Collections of other people shared with the user: invited as member, or published to friends. */
export async function listSharedCollections(): Promise<SharedCollection[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const [mem, fr] = await Promise.all([
    supabase.from('collection_members').select('collection_id, role').eq('user_id', user.id),
    supabase.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted'),
  ]);
  const roles = new Map(((mem.data ?? []) as { collection_id: string; role: 'viewer' | 'editor' }[]).map((m) => [m.collection_id, m.role]));
  const friendIds = [...new Set(((fr.data ?? []) as { requester_id: string; addressee_id: string }[]).map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id)))];
  type Row = { id: string; owner_id: string; name: string; description: string; collection_recipes: { count: number }[] };
  // Il filtro "condivisa con me" (membro o proprietario amico) e' applicato nel DB prima del limit:
  // altrimenti 200+ raccolte pubbliche di terzi spingerebbero fuori quelle realmente condivise.
  const conds: string[] = [];
  if (roles.size) conds.push(`id.in.(${[...roles.keys()].join(',')})`);
  if (friendIds.length) conds.push(`owner_id.in.(${friendIds.join(',')})`);
  if (!conds.length) return [];
  const { data: cols } = await supabase
    .from('collections')
    .select('id, owner_id, name, description, collection_recipes(count)')
    .neq('owner_id', user.id)
    .or(conds.join(','))
    .order('updated_at', { ascending: false })
    .limit(200);
  const rows = (cols ?? []) as Row[];
  const ownerIds = [...new Set(rows.map((c) => c.owner_id))];
  const { data: profs } = ownerIds.length ? await supabase.from('profiles').select('id, username, display_name').in('id', ownerIds) : { data: [] };
  const names = new Map(((profs ?? []) as { id: string; username: string; display_name: string }[]).map((p) => [p.id, p.display_name || p.username]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    count: c.collection_recipes?.[0]?.count ?? 0,
    role: roles.get(c.id) ?? 'viewer',
    ownerName: names.get(c.owner_id) ?? '',
  }));
}

/** Community recipes visible to the user (public + friends'), never the user's own. */
export async function listDiscoverable(opts: { category?: string; limit?: number; excludeCategoryIds?: string[] } = {}): Promise<RecipeListItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  let q = supabase
    .from('recipes')
    .select(LIST_COLUMNS)
    .neq('owner_id', user.id)
    .in('visibility', ['public', 'friends'])
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 60);
  if (opts.category) q = q.eq('category_id', opts.category);
  if (opts.excludeCategoryIds?.length) q = q.not('category_id', 'in', `(${opts.excludeCategoryIds.join(',')})`);
  const { data, error } = await q;
  assertNoError(error, 'listDiscoverable');
  const rows = (data as RecipeListItem[]) ?? [];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, username').in('id', ownerIds)
    : { data: [] };
  const names = new Map(((owners as { id: string; username: string }[]) ?? []).map((o) => [o.id, o.username]));
  return attachCovers(rows.map((r) => ({ ...r, ownerUsername: names.get(r.owner_id) ?? null })));
}
