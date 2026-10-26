import type { SupabaseClient } from '@supabase/supabase-js';
import { isOverImageQuota } from './limits';

/** True when the user already stores the maximum number of images (recipe images + cook-log photos). */
export async function userOverImageQuota(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    supabase.from('recipe_images').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    supabase.from('cook_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('photo_path', 'is', null),
  ]);
  return isOverImageQuota((a.count ?? 0) + (b.count ?? 0));
}
