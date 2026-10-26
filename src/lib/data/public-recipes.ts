import 'server-only';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { createTimeoutFetch } from '@/lib/supabase/fetch';
import { isValidSlug } from '@/lib/recipes/slug';
import type { PublicRecipe } from '@/lib/recipes/public-page';

/** Tag invalidated whenever any public page may have changed (list in the sitemap). */
export const PUBLIC_RECIPES_TAG = 'public-recipes';
export const publicRecipeTag = (slug: string) => `public-recipe:${slug}`;

export const SITEMAP_PAGE_SIZE = 5000;
const REVALIDATE_SECONDS = 3600;

/**
 * Anonymous client (anon key, no cookies, no session): the same access a crawler has.
 * It can only call the SECURITY DEFINER functions of migration 20261025000001.
 */
function anonClient() {
  const { supabaseUrl, supabaseAnonKey } = env();
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createTimeoutFetch() } });
}

async function fetchPublicRecipe(slug: string): Promise<PublicRecipe | null> {
  const { data, error } = await anonClient().rpc('get_public_recipe', { p_slug: slug }).maybeSingle();
  if (error) throw error;
  return (data as PublicRecipe | null) ?? null;
}

/** Cached per slug; the owner's edits invalidate the tag, otherwise it expires after an hour. */
export function getPublicRecipe(slug: string): Promise<PublicRecipe | null> {
  if (!isValidSlug(slug)) return Promise.resolve(null);
  return unstable_cache(() => fetchPublicRecipe(slug), ['public-recipe', slug], {
    tags: [PUBLIC_RECIPES_TAG, publicRecipeTag(slug)],
    revalidate: REVALIDATE_SECONDS,
  })();
}

export const countPublicRecipes = unstable_cache(
  async (): Promise<number> => {
    const { data, error } = await anonClient().rpc('count_public_recipes');
    if (error) throw error;
    return Number(data ?? 0);
  },
  ['public-recipes-count'],
  { tags: [PUBLIC_RECIPES_TAG], revalidate: REVALIDATE_SECONDS },
);

export function listPublicRecipeSlugs(page: number): Promise<{ slug: string; updated_at: string }[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await anonClient().rpc('list_public_recipe_slugs', { p_offset: page * SITEMAP_PAGE_SIZE, p_limit: SITEMAP_PAGE_SIZE });
      if (error) throw error;
      return (data ?? []) as { slug: string; updated_at: string }[];
    },
    ['public-recipes-slugs', String(page)],
    { tags: [PUBLIC_RECIPES_TAG], revalidate: REVALIDATE_SECONDS },
  )();
}

/** Storage paths of the cover image, only if it is the cover of an active public page. */
export async function getPublicCoverPaths(imageId: string): Promise<{ storage_path: string; thumb_path: string | null } | null> {
  const { data, error } = await anonClient().rpc('public_cover_paths', { p_image_id: imageId }).maybeSingle();
  if (error) throw error;
  return (data as { storage_path: string; thumb_path: string | null } | null) ?? null;
}

export async function downloadPublicCover(path: string): Promise<Blob | null> {
  const { data, error } = await anonClient().storage.from('recipe-images').download(path);
  return error ? null : data;
}
