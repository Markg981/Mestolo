import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { visibleAvatarIds } from '@/lib/data/profiles';
import { PageHeader } from '@/components/ui';
import { FriendSearch, FriendRow, BlockedRow } from './FriendsClient';
import { InviteSection, type InviteRow } from './InviteSection';

type Friendship = { id: string; requester_id: string; addressee_id: string; status: 'pending' | 'accepted' | 'declined' };

export async function generateMetadata() {
  const t = await getTranslations('friends');
  return { title: t('title') };
}

export default async function FriendsPage() {
  const [t, user] = await Promise.all([getTranslations('friends'), getUser()]);
  const supabase = await createClient();
  const [{ data: fs }, { data: bl }, { data: inv }] = await Promise.all([
    supabase.from('friendships').select('id, requester_id, addressee_id, status').order('created_at', { ascending: false }),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', user!.id),
    supabase
      .from('invites')
      .select('id, uses, max_uses, expires_at')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  ]);
  const friendships = (fs as Friendship[]) ?? [];
  const blockedIds = ((bl as { blocked_id: string }[]) ?? []).map((b) => b.blocked_id);
  const otherIds = [...new Set([...friendships.map((f) => (f.requester_id === user!.id ? f.addressee_id : f.requester_id)), ...blockedIds])];
  const { data: profiles } = otherIds.length ? await supabase.from('profiles').select('id, username, display_name').in('id', otherIds) : { data: [] };
  const withAvatar = await visibleAvatarIds(otherIds);
  const byId = new Map(((profiles as { id: string; username: string; display_name: string }[]) ?? []).map((p) => [p.id, { ...p, has_avatar: withAvatar.has(p.id) }]));
  const other = (f: Friendship) => byId.get(f.requester_id === user!.id ? f.addressee_id : f.requester_id);

  const incoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === user!.id);
  const outgoing = friendships.filter((f) => f.status !== 'accepted' && f.requester_id === user!.id);
  const friends = friendships.filter((f) => f.status === 'accepted');

  const section = (title: string, empty: string, children: React.ReactNode[]) => (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {children.length ? <ul className="flex flex-col gap-2">{children}</ul> : <p className="text-muted">{empty}</p>}
    </section>
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={t('title')} lead={t('lead')} />
      <FriendSearch existing={otherIds} />
      <InviteSection invites={((inv as InviteRow[]) ?? []).filter((i) => i.uses < i.max_uses)} />
      {section(
        t('incoming'),
        t('emptyIncoming'),
        incoming.map((f) => <FriendRow key={f.id} kind="incoming" friendshipId={f.id} profile={other(f)} />),
      )}
      {section(
        t('friendsList'),
        t('emptyFriends'),
        friends.map((f) => <FriendRow key={f.id} kind="friend" friendshipId={f.id} profile={other(f)} />),
      )}
      {outgoing.length > 0 &&
        section(
          t('outgoing'),
          '',
          outgoing.map((f) => <FriendRow key={f.id} kind={f.status === 'declined' ? 'declined' : 'outgoing'} friendshipId={f.id} profile={other(f)} />),
        )}
      {blockedIds.length > 0 &&
        section(
          t('blocked'),
          '',
          blockedIds.map((id) => <BlockedRow key={id} userId={id} profile={byId.get(id)} />),
        )}
      <p className="text-sm text-muted">
        {t('privacyNote')}{' '}
        <Link href="/settings" className="text-terracotta-deep underline underline-offset-4">
          {t('privacyLink')}
        </Link>
      </p>
    </div>
  );
}
