import { NextResponse, type NextRequest } from 'next/server';
import { downloadPublicCover, getPublicCoverPaths } from '@/lib/data/public-recipes';

/**
 * Cover image of a public recipe page, served to anyone (crawlers, social previews).
 * Only the cover of a recipe with an active public page is reachable: the path lookup
 * (public.public_cover_paths) and the storage policy for the anon role both check that
 * visibility is public, the page is enabled and the recipe is not hidden. Other images
 * keep going through /api/images, which requires a signed-in user.
 * The cache is short (no stale-while-revalidate) so a revoked or hidden cover stops being served within minutes;
 * the path lookup is uncached, so server-side visibility changes take effect immediately.
 */
// 404 con cache breve: attenua le scansioni di id inesistenti senza ritardare a lungo una cover appena pubblicata.
const NOT_FOUND_HEADERS = { 'cache-control': 'public, max-age=30, s-maxage=30' };
const notFound = () => new NextResponse(null, { status: 404, headers: NOT_FOUND_HEADERS });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();

  const paths = await getPublicCoverPaths(id).catch(() => null);
  if (!paths) return notFound();

  const wantThumb = request.nextUrl.searchParams.get('size') === 'thumb';
  const file = await downloadPublicCover(wantThumb && paths.thumb_path ? paths.thumb_path : paths.storage_path);
  if (!file) return notFound();

  return new NextResponse(file.stream(), {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=60, s-maxage=120',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
