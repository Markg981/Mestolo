import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { toMestoloJson, toSchemaOrg } from '@/lib/recipes/export';
import type { RecipeRow } from '@/lib/recipes/types';

/** Exports a single visible recipe. Visibility is enforced by RLS (no public links). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle();
  if (!data) return new NextResponse(null, { status: 404 });
  const r = data as RecipeRow;
  const [{ data: cat }, { data: imgs }, { data: owner }, { data: note }] = await Promise.all([
    r.category_id ? supabase.from('categories').select('slug, name').eq('id', r.category_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('recipe_images').select('kind, alt_text, attribution, source_url').eq('recipe_id', id),
    supabase.from('profiles').select('username, display_name').eq('id', r.owner_id).maybeSingle(),
    supabase.from('recipe_notes').select('body').eq('recipe_id', id).eq('owner_id', user.id).maybeSingle(),
  ]);
  const format = request.nextUrl.searchParams.get('format') === 'schema' ? 'schema' : 'mestolo';
  const authorName = r.original_author_name ?? owner?.display_name ?? owner?.username ?? null;
  const body =
    format === 'schema'
      ? toSchemaOrg(r, { authorName, categoryName: cat?.name ?? cat?.slug ?? null })
      : toMestoloJson(r, { categorySlug: cat?.slug ?? null, categoryName: cat?.name ?? null, images: imgs ?? [], personalNote: note?.body ?? null });
  const safeTitle = r.title.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ricetta';
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': format === 'schema' ? 'application/ld+json; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${safeTitle}.${format === 'schema' ? 'jsonld' : 'mestolo.json'}"`,
      'cache-control': 'no-store',
    },
  });
}
