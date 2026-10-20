import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { attachCovers, listCategories, LIST_COLUMNS, type RecipeListItem } from '@/lib/data/recipes';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { Badge, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { ProfileFriendButton } from './ProfileFriendButton';

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!/^[a-z0-9_]{3,24}$/.test(username)) notFound();
  const user = await getUser();
  const supabase = await createClient();
  // RLS: blocked users do not see each other's profile
  const { data: profile } = await supabase.from('profiles').select('id, username, display_name, bio').eq('username', username).maybeSingle();
  if (!profile) notFound();
  const [t, categories] = await Promise.all([getTranslations('profile'), listCategories()]);
  const isMe = profile.id === user!.id;
  // RLS returns only what the viewer may see: public, friends-only if friends, everything if it's me
  let q = supabase.from('recipes').select(LIST_COLUMNS).eq('owner_id', profile.id).order('created_at', { ascending: false }).limit(60);
  if (isMe) q = q.in('visibility', ['public', 'friends']);
  const { data: rows } = await q;
  const recipes = await attachCovers((rows as RecipeListItem[]) ?? []);
  const { data: fr } = isMe
    ? { data: null }
    : await supabase.from('friendships').select('id, status, requester_id').or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`).maybeSingle();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={profile.display_name || `@${profile.username}`}
        lead={profile.bio || undefined}
        actions={
          isMe ? (
            <LinkButton href="/settings">{t('edit')}</LinkButton>
          ) : (
            <ProfileFriendButton userId={profile.id} state={!fr ? 'none' : fr.status === 'accepted' ? 'friends' : fr.status === 'pending' ? (fr.requester_id === user!.id ? 'sent' : 'received') : 'declined'} />
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge>@{profile.username}</Badge>
        {fr?.status === 'accepted' && <Badge tone="basil">{t('friend')}</Badge>}
      </div>
      {isMe && <p className="text-sm text-muted">{t('selfNote')}</p>}
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">{t('recipesTitle')}</h2>
        {recipes.length ? (
          <RecipeGrid>
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} categories={categories} />
            ))}
          </RecipeGrid>
        ) : (
          <EmptyState title={t('emptyTitle')}>{t('empty')}</EmptyState>
        )}
      </section>
    </div>
  );
}
