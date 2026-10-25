import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/supabase/server';
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
    : [{ data: [] }, { data: [] }, { data: [] }];

  const body = {
    format: 'mestolo.account-export/v1',
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: profile.data,
    recipes: recipes.data,
    recipe_versions: versions.data,
    recipe_images_metadata: images.data,
    recipe_nutrition: nutrition.data,
    cook_logs: cookLogs.data,
    recipe_ratings: ratings.data,
    pantry_items: pantry.data,
    plan_preferences: planPrefs.data,
    notification_preferences: notifPrefs.data,
    push_subscriptions: pushSubs.data,
    invites: invites.data,
    invite_redemptions: redemptions.data,
    collection_members: collMembers.data,
    shopping_list_members: listMembers.data,
    shopping_aisle_overrides: aisles.data,
    ai_suggestions: suggestions.data,
    app_feedback: feedback.data,
    personal_notes: notes.data,
    favorites: favorites.data,
    custom_categories: categories.data,
    collections: collections.data,
    shopping_lists: shoppingLists.data,
    shopping_items: shoppingItems.data,
    meal_plan: plan.data,
    friendships: friendships.data,
    blocks: blocks.data,
    reports: reports.data,
    api_keys_configured: keys.data,
    ai_usage: usage.data,
    note: 'Image files can be downloaded from each recipe page. API key values are never exported.',
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="mestolo-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
