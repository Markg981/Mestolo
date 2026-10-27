import 'server-only';
import { createClient, getProfile, getUser, getUserTimeZone } from '@/lib/supabase/server';
import { conflictsWithPreferences, hiddenCategoriesFilter, pickOfTheDay } from '@/lib/discover/preferences';
import { attachCovers, LIST_COLUMNS, type RecipeListItem } from './recipes';
import { todayIso } from '@/lib/plan/week';
import type { Ingredient } from '@/lib/recipes/types';
import type { CategoryRow } from '@/lib/recipes/categories';
import { PAGE_SIZE, applyKeyset, decodeCursor, toPage, type KeysetSort } from '@/lib/pagination';

const DISCOVER_SORT: KeysetSort = { column: 'created_at', ascending: false };

export interface DiscoverResult {
  items: RecipeListItem[];
  hiddenByPreferences: number;
  recipeOfTheDay: RecipeListItem | null;
  nextCursor: string | null;
}

/**
 * Community recipes the user may see (public, or friends-only from friends),
 * never their own, filtered by declared preferences (indicative only).
 */
export async function discover(categories: CategoryRow[], opts: { category?: string; limit?: number; cursor?: string | null } = {}): Promise<DiscoverResult> {
  const user = await getUser();
  const profile = await getProfile();
  if (!user || !profile) return { items: [], hiddenByPreferences: 0, recipeOfTheDay: null, nextCursor: null };
  const supabase = await createClient();
  const hiddenCats = categories.filter((c) => c.owner_id === null && profile.hidden_categories.includes(c.slug)).map((c) => c.id);

  let q = supabase
    .from('recipes')
    .select(`${LIST_COLUMNS}, ingredients`)
    .neq('owner_id', user.id)
    .in('visibility', ['public', 'friends'])
    .eq('is_hidden', false);
  if (opts.category) q = q.eq('category_id', opts.category);
  if (hiddenCats.length && !opts.category) q = q.or(hiddenCategoriesFilter(hiddenCats));
  const pageSize = opts.limit ?? PAGE_SIZE;
  const { data } = await applyKeyset(q, DISCOVER_SORT, decodeCursor(opts.cursor), pageSize);
  // the cursor follows the rows served, before the (indicative) preference filter
  const page = toPage((data as (RecipeListItem & { ingredients: Ingredient[] })[]) ?? [], DISCOVER_SORT, pageSize);
  const rows = page.items;

  const kept = rows.filter((r) => !conflictsWithPreferences(r.ingredients ?? [], profile));
  const hiddenByPreferences = rows.length - kept.length;

  const ownerIds = [...new Set(kept.map((r) => r.owner_id))];
  const { data: owners } = ownerIds.length ? await supabase.from('profiles').select('id, username').in('id', ownerIds) : { data: [] };
  const names = new Map(((owners as { id: string; username: string }[]) ?? []).map((o) => [o.id, o.username]));
  const items = await attachCovers(
    kept.map(({ ingredients: _ingredients, ...r }) => {
      void _ingredients;
      return { ...r, ownerUsername: names.get(r.owner_id) ?? null };
    }),
  );
  const today = todayIso(new Date(), await getUserTimeZone());
  return { items, hiddenByPreferences, recipeOfTheDay: opts.cursor ? null : pickOfTheDay(items, user.id, today), nextCursor: page.nextCursor };
}
