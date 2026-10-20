import 'server-only';
import { createClient, getUser } from '@/lib/supabase/server';
import type { CategoryRow } from '@/lib/recipes/categories';
import type { RecipeRow } from '@/lib/recipes/types';

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

export async function listMyRecipes(f: RecipeFilters = {}): Promise<RecipeListItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  // With a text query the search goes through the search_recipes RPC (full-text + trigram,
  // security invoker so RLS still applies); PostgREST lets us chain filters on its result.
  const base = (owner: string | null) =>
    f.q
      ? supabase.rpc('search_recipes', { p_query: f.q.slice(0, 100), p_owner: owner, p_limit: 200 }).select(LIST_COLUMNS)
      : owner
        ? supabase.from('recipes').select(LIST_COLUMNS).eq('owner_id', owner)
        : supabase.from('recipes').select(LIST_COLUMNS);
  let query = base(user.id);

  if (f.favorites) {
    const { data: favs } = await supabase.from('favorites').select('recipe_id').eq('user_id', user.id);
    const ids = (favs ?? []).map((x: { recipe_id: string }) => x.recipe_id);
    // favourites may include recipes of other people: query them without the owner filter
    query = base(null).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  if (f.category) query = query.eq('category_id', f.category);
  if (f.tag) query = query.contains('tags', [f.tag]);
  if (f.review) query = query.eq('verification_status', 'needs_review');
  switch (f.sort) {
    case 'title':
      query = query.order('title');
      break;
    case 'updated':
      query = query.order('updated_at', { ascending: false });
      break;
    case 'quick':
      query = query.order('total_minutes', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }
  const { data } = await query.limit(f.limit ?? 120);
  return attachCovers((data as RecipeListItem[]) ?? []);
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
