import { ACCOUNT_EXPORT_FORMAT } from './import-json';

type Rows = unknown;

export interface AccountExportInput {
  user: { id: string; email?: string | null; created_at?: string | null };
  profile: Rows;
  recipes: Rows;
  versions: Rows;
  images: Rows;
  nutrition: Rows;
  cookLogs: Rows;
  ratings: Rows;
  pantry: Rows;
  planPrefs: Rows;
  notifPrefs: Rows;
  pushSubs: Rows;
  invites: Rows;
  redemptions: Rows;
  collMembers: Rows;
  listMembers: Rows;
  aisles: Rows;
  suggestions: Rows;
  feedback: Rows;
  notes: Rows;
  favorites: Rows;
  categories: Rows;
  collections: Rows;
  shoppingLists: Rows;
  shoppingItems: Rows;
  plan: Rows;
  friendships: Rows;
  blocks: Rows;
  reports: Rows;
  keys: Rows;
  usage: Rows;
}

/** Pure serialization of the account export (the keys are read back by import-json.ts). */
export function buildAccountExport(d: AccountExportInput) {
  return {
    format: ACCOUNT_EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    account: { id: d.user.id, email: d.user.email, created_at: d.user.created_at },
    profile: d.profile,
    recipes: d.recipes,
    recipe_versions: d.versions,
    recipe_images_metadata: d.images,
    recipe_nutrition: d.nutrition,
    cook_logs: d.cookLogs,
    recipe_ratings: d.ratings,
    pantry_items: d.pantry,
    plan_preferences: d.planPrefs,
    notification_preferences: d.notifPrefs,
    push_subscriptions: d.pushSubs,
    invites: d.invites,
    invite_redemptions: d.redemptions,
    collection_members: d.collMembers,
    shopping_list_members: d.listMembers,
    shopping_aisle_overrides: d.aisles,
    ai_suggestions: d.suggestions,
    app_feedback: d.feedback,
    personal_notes: d.notes,
    favorites: d.favorites,
    custom_categories: d.categories,
    collections: d.collections,
    shopping_lists: d.shoppingLists,
    shopping_items: d.shoppingItems,
    meal_plan: d.plan,
    friendships: d.friendships,
    blocks: d.blocks,
    reports: d.reports,
    api_keys_configured: d.keys,
    ai_usage: d.usage,
    note: 'Image files can be downloaded from each recipe page. Avatar and cook-log photos are referenced by storage path (profile.avatar_path, cook_logs[].photo_path), not embedded. API key values are never exported.',
  };
}
