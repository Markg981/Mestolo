import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Serves the photo of a cook log. Same model as /api/images: no public URLs, every request is
 * re-authorised. The log row is read with the user's client (RLS on cook_logs: author, or
 * recipe-visible and not private) and the file with the same client (RLS on storage.objects).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return new NextResponse(null, { status: 401 });

  const { data: log } = await supabase.from('cook_logs').select('user_id, photo_path').eq('id', id).maybeSingle();
  if (!log?.photo_path) return new NextResponse(null, { status: 404 });
  if (!log.photo_path.startsWith(`${log.user_id}/cook/`)) return new NextResponse(null, { status: 404 });

  const { data: file, error } = await supabase.storage.from('recipe-images').download(log.photo_path);
  if (error || !file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.stream(), {
    headers: {
      'content-type': 'image/webp',
      // the visibility of a log can change: revalidate instead of caching for a year
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
