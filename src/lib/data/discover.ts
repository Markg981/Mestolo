import 'server-only';
import { createClient, getProfile, getUser } from '@/lib/supabase/server';
import { conflictsWithPreferences, pickOfTheDay } from '@/lib/discover/preferences';
import { attachCovers, LIST_COLUMNS, type RecipeListItem } from './recipes';
import type { Ingredient } from '@/lib/recipes/types';
import type { CategoryRow } from '@/lib/recipes/categories';

export interface DiscoverResult {
  items: RecipeListItem[];
  hiddenByPreferences: number;
  recipeOfTheDay: RecipeListItem | null;
}

/**
 * Community recipes the user may see (public, or friends-only from friends),
 * never their own, filtered by declared preferences (indicative only).
 */
export async function discover(categories: CategoryRow[], opts: { category?: string; limit?: number } = {}): Promise<DiscoverResult> {
  const user = await getUser();
  const profile = await getProfile();
  if (!user || !profile) return { items: [], hiddenByPreferences: 0, recipeOfTheDay: null };
  const supabase = await createClient();
  const hiddenCats = categories.filter((c) => c.owner_id === null && profile.hidden_categories.includes(c.slug)).map((c) => c.id);

  let q = supabase
    .from('recipes')
    .select(`${LIST_COLUMNS}, ingredients`)
    .neq('owner_id', user.id)
    .in('visibility', ['public', 'friends'])
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 90);
  if (opts.category) q = q.eq('category_id', opts.category);
  if (hiddenCats.length && !opts.category) q = q.not('category_id', 'in', `(${hiddenCats.join(',')})`);
  const { data } = await q;
  const rows = (data as (RecipeListItem & { ingredients: Ingredient[] })[]) ?? [];

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
  const today = new Date().toISOString().slice(0, 10);
  return { items, hiddenByPreferences, recipeOfTheDay: pickOfTheDay(items, user.id, today) };
}
