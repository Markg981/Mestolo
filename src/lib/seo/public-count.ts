import { countPublicRecipes } from '@/lib/data/public-recipes';
import { isSupabaseConfigured } from '@/lib/env';

let warned = false;

/**
 * Number of public recipes for sitemap/robots. If the DB is unreachable (e.g. local build with
 * Supabase down) it returns 0 so the output stays deterministic, and logs the error once per
 * process instead of once per call. The error is never silent: it is always reported.
 */
export async function countPublicRecipesSafe(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    return await countPublicRecipes();
  } catch (e) {
    if (!warned) {
      warned = true;
      console.error('[seo] count_public_recipes failed, falling back to an empty sitemap:', e instanceof Error ? e.message : 'unknown error');
    }
    return 0;
  }
}

/** Test helper. */
export function resetPublicCountWarning() {
  warned = false;
}
