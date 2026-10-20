import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { attachCovers, listCategories, LIST_COLUMNS, type RecipeListItem } from '@/lib/data/recipes';
import { getProfileCard } from '@/lib/data/profiles';
import { Avatar } from '@/components/Avatar';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { ProfileFriendButton } from './ProfileFriendButton';

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!/^[a-z0-9_]{3,24}$/.test(username)) notFound();
  const user = await getUser();
  const supabase = await createClient();
  // The card respects profile_visibility and blocks: strangers get name and username only
  const profile = await getProfileCard(username);
  if (!profile) notFound();
  const [t, categories] = await Promise.all([getTranslations('profile'), listCategories()]);
  const tr = await getTranslations('richProfile');
  const isMe = profile.id === user!.id;
  // RLS returns only what the viewer may see: public, friends-only if friends, everything if it's me
  let q = supabase.from('recipes').select(LIST_COLUMNS).eq('owner_id', profile.id).order('created_at', { ascending: false }).limit(60);
  if (isMe) q = q.in('visibility', ['public', 'friends']);
  const [{ data: rows }, { count: recipeCount }] = await Promise.all([
    q,
    supabase.from('recipes').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id),
  ]);
  const recipes = await attachCovers((rows as RecipeListItem[]) ?? []);
  const { data: fr } = isMe
    ? { data: null }
    : await supabase.from('friendships').select('id, status, requester_id').or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`).maybeSingle();
  const name = profile.display_name || `@${profile.username}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Avatar userId={profile.id} name={name} hasImage={profile.can_view && !!profile.avatar_path} size="lg" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={name}
            lead={profile.bio || undefined}
            actions={
              isMe ? (
                <LinkButton href="/settings">{t('edit')}</LinkButton>
              ) : (
                <ProfileFriendButton userId={profile.id} state={!fr ? 'none' : fr.status === 'accepted' ? 'friends' : fr.status === 'pending' ? (fr.requester_id === user!.id ? 'sent' : 'received') : 'declined'} />
              )
            }
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>@{profile.username}</Badge>
        {fr?.status === 'accepted' && <Badge tone="basil">{t('friend')}</Badge>}
        {profile.location && <Badge>{profile.location}</Badge>}
        {profile.favorite_cuisines.map((c) => (
          <Badge key={c} tone="saffron">
            {c}
          </Badge>
        ))}
      </div>
      {profile.website && (
        <p>
          <a href={profile.website} rel="nofollow ugc noopener" target="_blank" className="text-basil underline underline-offset-4">
            {profile.website.replace(/^https:\/\//, '').replace(/\/$/, '')}
          </a>
        </p>
      )}
      {isMe && <p className="text-sm text-muted">{tr(`selfNote_${profile.profile_visibility ?? 'friends'}`)}</p>}
      {!profile.can_view && !isMe && <p className="text-sm text-muted">{tr('restricted')}</p>}
      <dl className="grid grid-cols-3 gap-3">
        <Card className="text-center">
          <dd className="text-2xl font-bold">{recipeCount ?? 0}</dd>
          <dt className="text-sm text-muted">{tr('statRecipes')}</dt>
        </Card>
        <Card className="text-center">
          <dd className="text-2xl font-bold">{profile.friends_count ?? '–'}</dd>
          <dt className="text-sm text-muted">{tr('statFriends')}</dt>
        </Card>
        {/* Slot for the "cooked" count (cook_logs), filled by the cook-logs feature */}
        <Card className="text-center">
          <dd className="text-2xl font-bold">–</dd>
          <dt className="text-sm text-muted">{tr('statCooked')}</dt>
        </Card>
      </dl>
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
