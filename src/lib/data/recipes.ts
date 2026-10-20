import 'server-only';
import { createClient, getUser } from '@/lib/supabase/server';
import type { CategoryRow } from '@/lib/recipes/categories';
import type { RecipeRow } from '@/lib/recipes/types';
import { PAGE_SIZE, applyKeyset, decodeCursor, toPage, type KeysetSort, type Page } from '@/lib/pagination';

/** All reads go through the user's client: RLS decides what is visible. */

export const LIST_COLUMNS =
  'id, owner_id, title, description, original_language, servings, prep_minutes, cook_minutes, total_minutes, category_id, tags, visibility, verification_status, source_type, source_name, created_at, updated_at, original_author_name, is_hidden';

export type RecipeListItem = Pick<
  RecipeRow,
  | 'id' | 'owner_id' | 'title' | 'description' | 'original_language' | 'servings' | 'prep_minutes' | 'cook_minutes' | 'total_minutes'
  | 'category_id' | 'tags' | 'visibility' | 'verification_status' | 'source_type' | 'source_name' | 'created_at' | 'updated_at' | 'original_author_name' | 'is_hidden'
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

export async function listCategories(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const user = await getUser();
  const { data } = await supabase
    .from('categories')
    .select('id, slug, owner_id, name, sort_order')
    .or(`owner_id.is.null${user ? `,owner_id.eq.${user.id}` : ''}`)
    .order('sort_order')
    .order('name');
  return (data as CategoryRow[]) ?? [];
}

export async function attachCovers<T extends { id: string; owner_id: string }>(rows: T[]): Promise<(T & { coverImageId: string | null; coverKind: string | null })[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('recipe_images')
    .select('id, recipe_id, kind, position')
    .in('recipe_id', rows.map((r) => r.id))
    .order('position');
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

async function buildMyRecipesQuery(f: RecipeFilters, userId: string) {
  const supabase = await createClient();
  // With a text query the search goes through the search_recipes RPC (full-text + trigram,
  // security invoker so RLS still applies). p_limit null returns every match, so sorting and
  // keyset pagination are applied by PostgREST on its result like on the plain table.
  const base = (owner: string | null) =>
    f.q
      ? supabase.rpc('search_recipes', { p_query: f.q.slice(0, 100), p_owner: owner, p_limit: null }).select(LIST_COLUMNS)
      : owner
        ? supabase.from('recipes').select(LIST_COLUMNS).eq('owner_id', owner)
        : supabase.from('recipes').select(LIST_COLUMNS);
  let query = base(userId);

  if (f.favorites) {
    const { data: favs } = await supabase.from('favorites').select('recipe_id').eq('user_id', userId);
    const ids = (favs ?? []).map((x: { recipe_id: string }) => x.recipe_id);
    // favourites may include recipes of other people: query them without the owner filter
    query = base(null).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  if (f.category) query = query.eq('category_id', f.category);
  if (f.tag) query = query.contains('tags', [f.tag]);
  if (f.review) query = query.eq('verification_status', 'needs_review');
  // wrapped: a bare query builder is thenable and would be executed by the `await` of the async function
  return { query };
}

/** First N recipes of the user (home page widgets). */
export async function listMyRecipes(f: RecipeFilters = {}): Promise<RecipeListItem[]> {
  const user = await getUser();
  if (!user) return [];
  const { query } = await buildMyRecipesQuery(f, user.id);
  const sort = keysetSortFor(f.sort);
  const { data } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order('id', { ascending: sort.ascending }).limit(f.limit ?? 120);
  return attachCovers((data as RecipeListItem[]) ?? []);
}

/** One page of the user's recipes, keyset-paginated on the chosen sort (+ id as tie-breaker). */
export async function listMyRecipesPage(f: RecipeFilters = {}, cursor?: string | null): Promise<Page<RecipeListItem>> {
  const user = await getUser();
  if (!user) return { items: [], nextCursor: null };
  const { query } = await buildMyRecipesQuery(f, user.id);
  const sort = keysetSortFor(f.sort);
  const pageSize = f.limit ?? PAGE_SIZE;
  const { data } = await applyKeyset(query, sort, decodeCursor(cursor), pageSize);
  const page = toPage((data as RecipeListItem[]) ?? [], sort, pageSize);
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
  const { data: recipe } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle();
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
  const { data } = await supabase
    .from('collections')
    .select('id, name, description, updated_at, collection_recipes(count)')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as { id: string; name: string; description: string; updated_at: string; collection_recipes: { count: number }[] }[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    count: c.collection_recipes?.[0]?.count ?? 0,
  }));
}

export type SharedCollection = { id: string; name: string; description: string; count: number; role: 'viewer' | 'editor'; ownerName: string };

/** Collections of other people shared with the user: invited as member, or published to friends. */
export async function listSharedCollections(): Promise<SharedCollection[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const [cols, mem, fr] = await Promise.all([
    supabase
      .from('collections')
      .select('id, owner_id, name, description, collection_recipes(count)')
      .neq('owner_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase.from('collection_members').select('collection_id, role').eq('user_id', user.id),
    supabase.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted'),
  ]);
  const roles = new Map(((mem.data ?? []) as { collection_id: string; role: 'viewer' | 'editor' }[]).map((m) => [m.collection_id, m.role]));
  const friendIds = new Set(((fr.data ?? []) as { requester_id: string; addressee_id: string }[]).map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id)));
  type Row = { id: string; owner_id: string; name: string; description: string; collection_recipes: { count: number }[] };
  const rows = ((cols.data ?? []) as Row[]).filter((c) => roles.has(c.id) || friendIds.has(c.owner_id));
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
  const { data } = await q;
  const rows = (data as RecipeListItem[]) ?? [];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, username').in('id', ownerIds)
    : { data: [] };
  const names = new Map(((owners as { id: string; username: string }[]) ?? []).map((o) => [o.id, o.username]));
  return attachCovers(rows.map((r) => ({ ...r, ownerUsername: names.get(r.owner_id) ?? null })));
}
