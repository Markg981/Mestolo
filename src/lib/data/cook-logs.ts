import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** Reads go through the user's client: RLS on cook_logs decides which logs are visible. */

export interface CookLogItem {
  id: string;
  recipe_id: string;
  user_id: string;
  cooked_at: string;
  note: string;
  has_photo: boolean;
  visibility: 'private' | 'recipe';
  username: string | null;
  displayName: string | null;
}

const COLS = 'id, recipe_id, user_id, cooked_at, note, photo_path, visibility';
type Row = { id: string; recipe_id: string; user_id: string; cooked_at: string; note: string; photo_path: string | null; visibility: 'private' | 'recipe' };

/** Times cooked + latest visible logs of a recipe (the count only includes logs the user can see). */
export async function listRecipeCookLogs(recipeId: string, limit = 12): Promise<{ count: number; logs: CookLogItem[] }> {
  const supabase = await createClient();
  const { data, count } = await supabase.from('cook_logs').select(COLS, { count: 'exact' }).eq('recipe_id', recipeId).order('cooked_at', { ascending: false }).limit(limit);
  const rows = (data as Row[] | null) ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, username, display_name').in('id', ids) : { data: [] };
  const byId = new Map(((profiles as { id: string; username: string; display_name: string | null }[]) ?? []).map((p) => [p.id, p]));
  return {
    count: count ?? rows.length,
    logs: rows.map((r) => ({
      id: r.id,
      recipe_id: r.recipe_id,
      user_id: r.user_id,
      cooked_at: r.cooked_at,
      note: r.note,
      has_photo: !!r.photo_path,
      visibility: r.visibility,
      username: byId.get(r.user_id)?.username ?? null,
      displayName: byId.get(r.user_id)?.display_name ?? null,
    })),
  };
}

export interface MyCookLog extends CookLogItem {
  recipeTitle: string | null;
}

/** The current user's own history, newest first. */
export async function listMyCookLogs(userId: string, limit = 60): Promise<MyCookLog[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('cook_logs').select(COLS).eq('user_id', userId).order('cooked_at', { ascending: false }).limit(limit);
  const rows = (data as Row[] | null) ?? [];
  const rids = [...new Set(rows.map((r) => r.recipe_id))];
  const { data: recipes } = rids.length ? await supabase.from('recipes').select('id, title').in('id', rids) : { data: [] };
  const titles = new Map(((recipes as { id: string; title: string }[]) ?? []).map((r) => [r.id, r.title]));
  return rows.map((r) => ({
    id: r.id,
    recipe_id: r.recipe_id,
    user_id: r.user_id,
    cooked_at: r.cooked_at,
    note: r.note,
    has_photo: !!r.photo_path,
    visibility: r.visibility,
    username: null,
    displayName: null,
    recipeTitle: titles.get(r.recipe_id) ?? null,
  }));
}
