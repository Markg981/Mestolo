import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { buildAccountExport } from '@/lib/recipes/account-export';
import { fetchAllChunked, fetchAllPages } from '@/lib/supabase/paginate';
import { enforceRateLimit, RateLimitedError } from '@/lib/rate-limit';

/**
 * Personal data export (GDPR-style portability). Separate from publishing:
 * it only returns the requesting user's own data. API keys are NOT exported
 * (only which providers are configured).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  try {
    await enforceRateLimit('export_data', user.id);
  } catch (e) {
    if (e instanceof RateLimitedError) return new NextResponse('Too many requests', { status: 429 });
    // Fail-closed: se il rate limit non e' verificabile (RPC in errore) non esportiamo.
    return new NextResponse('Service unavailable', { status: 503, headers: { 'retry-after': '30' } });
  }
  const supabase = await createClient();
  // Ogni tabella e' letta a pagine (max_rows di PostgREST = 1000, troncamento silenzioso)
  // con un ordine stabile e univoco, cosi' le pagine non si sovrappongono ne' saltano righe.
  const paged = (table: string, filter: (q: any) => any, order: string[], columns = '*') => // eslint-disable-line @typescript-eslint/no-explicit-any
    fetchAllPages((from, to) => {
      let q = filter(supabase.from(table).select(columns));
      for (const o of order) q = q.order(o);
      return q.range(from, to);
    });
  const own = (table: string, col = 'owner_id', order: string[] = ['id']) => paged(table, (q) => q.eq(col, user.id), order);
  const [profile, recipes, notes, favorites, collections, shoppingLists, shoppingItems, plan, friendships, blocks, reports, keys, usage, categories] = await Promise.all([
    supabase.rpc('my_profile').maybeSingle(),
    own('recipes'),
    own('recipe_notes', 'owner_id', ['recipe_id']),
    own('favorites', 'user_id', ['recipe_id']),
    paged('collections', (q) => q.eq('owner_id', user.id), ['id'], '*, collection_recipes(recipe_id, added_at)'),
    own('shopping_lists'),
    own('shopping_items'),
    own('meal_plan_entries'),
    paged('friendships', (q) => q, ['id']),
    own('blocks', 'blocker_id', ['blocked_id']),
    own('reports', 'reporter_id'),
    supabase.rpc('my_api_keys'),
    own('ai_usage', 'user_id'),
    own('categories'),
  ]);
  const [cookLogs, ratings, pantry, planPrefs, notifPrefs, pushSubs, invites, redemptions, collMembers, listMembers, aisles, suggestions, feedback] = await Promise.all([
    own('cook_logs', 'user_id'),
    own('recipe_ratings', 'user_id', ['recipe_id']),
    own('pantry_items'),
    own('plan_preferences', 'user_id', ['user_id']),
    own('notification_preferences', 'user_id', ['user_id']),
    // Niente chiavi crittografiche (p256dh/auth): solo i dispositivi registrati.
    paged('push_subscriptions', (q) => q.eq('user_id', user.id), ['id'], 'id, endpoint, user_agent, created_at'),
    own('invites', 'inviter_id'),
    own('invite_redemptions', 'redeemer_id', ['invite_id']),
    own('collection_members', 'user_id', ['collection_id']),
    own('shopping_list_members', 'user_id', ['list_id']),
    own('shopping_aisle_overrides', 'set_by', ['list_id', 'name_key']),
    own('ai_suggestions', 'user_id'),
    own('app_feedback', 'user_id'),
  ]);
  // `.in('recipe_id', ...)` con centinaia di id supera il limite di lunghezza dell'URL: a blocchi da 100.
  const chunked = (table: string, ids: string[], order: string[], columns = '*') =>
    fetchAllChunked(ids, (chunk, from, to) => {
      let q = supabase.from(table).select(columns).in('recipe_id', chunk);
      for (const o of order) q = q.order(o);
      return q.range(from, to);
    });
  const recipeIds = ((recipes.data as { id: string }[]) ?? []).map((r) => r.id);
  const [versions, images, nutrition] = recipeIds.length
    ? await Promise.all([
        chunked('recipe_versions', recipeIds, ['id']),
        chunked('recipe_images', recipeIds, ['id'], 'id, recipe_id, kind, source_url, attribution, alt_text, created_at'),
        chunked('recipe_nutrition', recipeIds, ['recipe_id']),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  // Una query fallita non deve produrre un export parziale con 200: l'utente
  // crederebbe di avere tutti i dati. Si logga solo il nome della sezione e il
  // codice errore (mai dati personali).
  const results: Record<string, { data?: unknown; error?: { code?: string } | null }> = {
    profile, recipes, notes, favorites, collections, shoppingLists, shoppingItems, plan, friendships, blocks, reports, keys, usage, categories,
    cookLogs, ratings, pantry, planPrefs, notifPrefs, pushSubs, invites, redemptions, collMembers, listMembers, aisles, suggestions, feedback,
    versions, images, nutrition,
  };
  const failed = Object.entries(results).filter(([, r]) => r.error);
  if (failed.length) {
    console.error('account export failed', failed.map(([name, r]) => `${name}:${r.error?.code ?? 'unknown'}`).join(','));
    return new NextResponse('Export failed', { status: 500, headers: { 'cache-control': 'no-store' } });
  }

  const body = buildAccountExport({
    user,
    profile: profile.data,
    recipes: recipes.data,
    versions: versions.data,
    images: images.data,
    nutrition: nutrition.data,
    cookLogs: cookLogs.data,
    ratings: ratings.data,
    pantry: pantry.data,
    planPrefs: planPrefs.data,
    notifPrefs: notifPrefs.data,
    pushSubs: pushSubs.data,
    invites: invites.data,
    redemptions: redemptions.data,
    collMembers: collMembers.data,
    listMembers: listMembers.data,
    aisles: aisles.data,
    suggestions: suggestions.data,
    feedback: feedback.data,
    notes: notes.data,
    favorites: favorites.data,
    categories: categories.data,
    collections: collections.data,
    shoppingLists: shoppingLists.data,
    shoppingItems: shoppingItems.data,
    plan: plan.data,
    friendships: friendships.data,
    blocks: blocks.data,
    reports: reports.data,
    keys: keys.data,
    usage: usage.data,
  });
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="mestolo-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
