import type { MetadataRoute } from 'next';
import { countPublicRecipes, listPublicRecipeSlugs, SITEMAP_PAGE_SIZE } from '@/lib/data/public-recipes';
import { isSupabaseConfigured, env } from '@/lib/env';
import { publicRecipeUrl } from '@/lib/recipes/public-page';

// Rebuilt at most once an hour; owners' edits and moderation also invalidate the data tag.
export const revalidate = 3600;
export const dynamic = 'force-dynamic';

/** One sitemap file (/sitemap/<id>.xml) per SITEMAP_PAGE_SIZE public recipes. */
export async function generateSitemaps() {
  let total = 0;
  try {
    if (isSupabaseConfigured()) total = await countPublicRecipes();
  } catch {
    total = 0;
  }
  const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
  return Array.from({ length: pages }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const page = Number(await id);
  if (!Number.isInteger(page) || page < 0 || !isSupabaseConfigured()) return [];
  const { siteUrl } = env();
  try {
    const rows = await listPublicRecipeSlugs(page);
    return rows.map((r) => ({ url: publicRecipeUrl(siteUrl, r.slug), lastModified: new Date(r.updated_at), changeFrequency: 'weekly' as const, priority: 0.6 }));
  } catch {
    return [];
  }
}
