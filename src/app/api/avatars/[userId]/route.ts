import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Serves avatars. The path is resolved through get_avatar_paths (profile
 * visibility rules) and the file is downloaded with the user's client, so storage
 * RLS re-checks the same rule. Short private cache: avatars can be replaced.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return new NextResponse(null, { status: 401 });

  const { data } = await supabase.rpc('get_avatar_paths', { p_ids: [userId] });
  const path = (data as { id: string; avatar_path: string }[] | null)?.[0]?.avatar_path;
  if (!path || !path.startsWith(`${userId}/`)) return new NextResponse(null, { status: 404 });
  const { data: file, error } = await supabase.storage.from('avatars').download(path);
  if (error || !file) return new NextResponse(null, { status: 404 });
  return new NextResponse(file.stream(), {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
