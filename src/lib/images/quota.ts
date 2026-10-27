import type { SupabaseClient } from '@supabase/supabase-js';
import { isOverImageQuota, isOverStorageBytes } from './limits';

/** True when the user already stores the maximum number of images (recipe images + cook-log photos) or bytes. */
export async function userOverImageQuota(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const [a, b, c] = await Promise.all([
    supabase.from('recipe_images').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    supabase.from('cook_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('photo_path', 'is', null),
    supabase.from('recipe_images').select('size_bytes').eq('owner_id', userId),
  ]);
  const bytes = ((c.data ?? []) as { size_bytes: number | null }[]).reduce((n, r) => n + (r.size_bytes ?? 0), 0);
  return isOverImageQuota((a.count ?? 0) + (b.count ?? 0)) || isOverStorageBytes(bytes);
}
