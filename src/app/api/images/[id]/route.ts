import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Serves recipe images. There are no public storage URLs: every request is
 * re-authorised. The metadata row is read with the user's client (RLS on
 * recipe_images) and the file is downloaded with the same client (RLS on
 * storage.objects), so knowing an image id or path is not enough.
 *
 * Performance: the JWT is verified locally with getClaims (JWKS cached, no Auth
 * server round trip; RLS re-checks the same JWT on every query anyway). Files
 * are written once under a random name and never updated, so the id is
 * content-addressed and the response can be cached by the browser for a year.
 * The cache is `private`: shared caches/CDNs never store it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return new NextResponse(null, { status: 401 });

  const { data: img } = await supabase.from('recipe_images').select('owner_id, storage_path, thumb_path').eq('id', id).maybeSingle();
  if (!img) return new NextResponse(null, { status: 404 });

  // Difesa in profondità: il file deve stare nella cartella del proprietario della riga
  const prefix = `${img.owner_id}/`;
  if (!img.storage_path.startsWith(prefix) || (img.thumb_path && !img.thumb_path.startsWith(prefix))) {
    return new NextResponse(null, { status: 404 });
  }

  const wantThumb = request.nextUrl.searchParams.get('size') === 'thumb';
  const path = wantThumb && img.thumb_path ? img.thumb_path : img.storage_path;
  const { data: file, error } = await supabase.storage.from('recipe-images').download(path);
  if (error || !file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.stream(), {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
