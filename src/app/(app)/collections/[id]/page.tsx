import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { attachCovers, listCategories, LIST_COLUMNS, type RecipeListItem } from '@/lib/data/recipes';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { Badge, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { CollectionAdmin } from '../CollectionForms';
import { RemoveFromCollection } from '../RemoveFromCollection';
import { ShareCollection } from '../ShareCollection';

type Profile = { id: string; username: string; display_name: string };
const label = (p: Profile) => p.display_name || p.username;

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  const supabase = await createClient();
  const { data: col } = await supabase.from('collections').select('id, owner_id, name, description, visibility').eq('id', id).maybeSingle();
  if (!col) notFound();
  const isOwner = col.owner_id === user!.id;
  const [t, ts, categories] = await Promise.all([getTranslations('collections'), getTranslations('collectionSharing'), listCategories()]);
  const { data: links } = await supabase.from('collection_recipes').select('recipe_id, added_at').eq('collection_id', id).order('added_at', { ascending: false });
  const ids = ((links as { recipe_id: string }[]) ?? []).map((l) => l.recipe_id);
  const { data: rows } = ids.length ? await supabase.from('recipes').select(LIST_COLUMNS).in('id', ids) : { data: [] };
  const recipes = await attachCovers((rows as RecipeListItem[]) ?? []);
  const ordered = ids.map((rid) => recipes.find((r) => r.id === rid)).filter(Boolean) as RecipeListItem[];
  // Recipes the viewer is not allowed to see (RLS) stay as placeholders.
  const unavailable = ids.length - ordered.length;

  let share: React.ReactNode = null;
  let role: 'viewer' | 'editor' | null = null;
  let ownerName = '';
  if (isOwner) {
    const [{ data: mem }, { data: fs }] = await Promise.all([
      supabase.from('collection_members').select('user_id, role').eq('collection_id', id),
      supabase.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted'),
    ]);
    const members = (mem as { user_id: string; role: 'viewer' | 'editor' }[]) ?? [];
    const friendIds = ((fs as { requester_id: string; addressee_id: string }[]) ?? []).map((f) => (f.requester_id === user!.id ? f.addressee_id : f.requester_id));
    const all = [...new Set([...friendIds, ...members.map((m) => m.user_id)])];
    const { data: profs } = all.length ? await supabase.from('profiles').select('id, username, display_name').in('id', all) : { data: [] };
    const byId = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
    share = (
      <ShareCollection
        id={col.id}
        visibility={col.visibility}
        members={members.map((m) => ({ id: m.user_id, name: byId.has(m.user_id) ? label(byId.get(m.user_id)!) : '?', role: m.role }))}
        friends={friendIds.filter((f) => byId.has(f)).map((f) => ({ id: f, name: label(byId.get(f)!) }))}
      />
    );
  } else {
    const [{ data: owner }, { data: mine }] = await Promise.all([
      supabase.from('profiles').select('id, username, display_name').eq('id', col.owner_id).maybeSingle(),
      supabase.from('collection_members').select('role').eq('collection_id', id).eq('user_id', user!.id).maybeSingle(),
    ]);
    ownerName = owner ? label(owner as Profile) : '';
    role = (mine as { role: 'viewer' | 'editor' } | null)?.role ?? 'viewer';
  }
  const canEdit = isOwner || role === 'editor';
  return (
    <div>
      <PageHeader
        title={col.name}
        lead={col.description || undefined}
        back={
          <Link href="/collections" className="inline-flex min-h-11 items-center self-start text-terracotta-deep underline underline-offset-4">
            {t('title')}
          </Link>
        }
        actions={
          isOwner ? (
            <div className="flex gap-2">
              {share}
              <CollectionAdmin id={col.id} name={col.name} description={col.description} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {ownerName && <span className="text-sm text-muted">{ts('by', { name: ownerName })}</span>}
              <Badge tone="saffron">{role === 'editor' ? ts('editor') : ts('readOnly')}</Badge>
            </div>
          )
        }
      />
      {ordered.length || unavailable ? (
        <RecipeGrid>
          {ordered.map((r) =>
            canEdit ? (
              <div key={r.id} className="flex flex-col items-start gap-1">
                <RecipeCard recipe={r} categories={categories} showAuthor={r.owner_id !== user!.id} />
                <RemoveFromCollection collectionId={col.id} recipeId={r.id} />
              </div>
            ) : (
              <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor={r.owner_id !== user!.id} />
            ),
          )}
          {Array.from({ length: unavailable }, (_, i) => (
            <div key={`na-${i}`} className="flex min-h-24 items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line p-5 text-sm text-muted">
              {ts('unavailable')}
            </div>
          ))}
        </RecipeGrid>
      ) : (
        <EmptyState title={t('emptyCollectionTitle')} action={isOwner ? <LinkButton href="/recipes">{t('browseRecipes')}</LinkButton> : undefined}>
          {isOwner ? t('emptyCollection') : ts('emptyShared')}
        </EmptyState>
      )}
    </div>
  );
}
