import type { MetadataRoute } from 'next';
import { SITEMAP_PAGE_SIZE } from '@/lib/data/public-recipes';
import { env } from '@/lib/env';
import { countPublicRecipesSafe } from '@/lib/seo/public-count';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

/** Crawlers may read the public recipe pages (/r/) and the welcome page; the app itself is off limits. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { siteUrl } = env();
  const pages = Math.max(1, Math.ceil((await countPublicRecipesSafe()) / SITEMAP_PAGE_SIZE));
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/r/', '/api/public-images/', '/welcome', '/privacy', '/terms'],
        disallow: ['/api/', '/auth/', '/login', '/signup', '/forgot-password', '/setup', '/recipes', '/discover', '/plan', '/shopping', '/collections', '/friends', '/import', '/moderation', '/more', '/settings', '/u/', '/print/', '/share', '/offline'],
      },
    ],
    sitemap: Array.from({ length: pages }, (_, i) => `${siteUrl}/sitemap/${i}.xml`),
  };
}
