import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { buildAccountExport } from '@/lib/recipes/account-export';
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
  const own = (table: string, col = 'owner_id') => supabase.from(table).select('*').eq(col, user.id);
  const [profile, recipes, notes, favorites, collections, shoppingLists, shoppingItems, plan, friendships, blocks, reports, keys, usage, categories] = await Promise.all([
    supabase.rpc('my_profile').maybeSingle(),
    own('recipes'),
    own('recipe_notes'),
    own('favorites', 'user_id'),
    supabase.from('collections').select('*, collection_recipes(recipe_id, added_at)').eq('owner_id', user.id),
    own('shopping_lists'),
    own('shopping_items'),
    own('meal_plan_entries'),
    supabase.from('friendships').select('*'),
    own('blocks', 'blocker_id'),
    own('reports', 'reporter_id'),
    supabase.rpc('my_api_keys'),
    own('ai_usage', 'user_id'),
    own('categories'),
  ]);
  const [cookLogs, ratings, pantry, planPrefs, notifPrefs, pushSubs, invites, redemptions, collMembers, listMembers, aisles, suggestions, feedback] = await Promise.all([
    own('cook_logs', 'user_id'),
    own('recipe_ratings', 'user_id'),
    own('pantry_items'),
    own('plan_preferences', 'user_id'),
    own('notification_preferences', 'user_id'),
    // Niente chiavi crittografiche (p256dh/auth): solo i dispositivi registrati.
    supabase.from('push_subscriptions').select('id, endpoint, user_agent, created_at').eq('user_id', user.id),
    own('invites', 'inviter_id'),
    own('invite_redemptions', 'redeemer_id'),
    own('collection_members', 'user_id'),
    own('shopping_list_members', 'user_id'),
    own('shopping_aisle_overrides', 'set_by'),
    own('ai_suggestions', 'user_id'),
    own('app_feedback', 'user_id'),
  ]);
  const recipeIds = ((recipes.data as { id: string }[]) ?? []).map((r) => r.id);
  const [versions, images, nutrition] = recipeIds.length
    ? await Promise.all([
        supabase.from('recipe_versions').select('*').in('recipe_id', recipeIds),
        supabase.from('recipe_images').select('id, recipe_id, kind, source_url, attribution, alt_text, created_at').in('recipe_id', recipeIds),
        supabase.from('recipe_nutrition').select('*').in('recipe_id', recipeIds),
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
