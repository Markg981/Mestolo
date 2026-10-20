import { NextResponse, type NextRequest } from 'next/server';
import { downloadPublicCover, getPublicCoverPaths } from '@/lib/data/public-recipes';

/**
 * Cover image of a public recipe page, served to anyone (crawlers, social previews).
 * Only the cover of a recipe with an active public page is reachable: the path lookup
 * (public.public_cover_paths) and the storage policy for the anon role both check that
 * visibility is public, the page is enabled and the recipe is not hidden. Other images
 * keep going through /api/images, which requires a signed-in user.
 * The cache is short and shared: if the owner turns the page off, the image stops quickly.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });

  const paths = await getPublicCoverPaths(id).catch(() => null);
  if (!paths) return new NextResponse(null, { status: 404 });

  const wantThumb = request.nextUrl.searchParams.get('size') === 'thumb';
  const file = await downloadPublicCover(wantThumb && paths.thumb_path ? paths.thumb_path : paths.storage_path);
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.stream(), {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
