'use client';

import { Avatar } from '@/components/Avatar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { blockUser, removeFriendship, respondFriendRequest, searchUsers, sendFriendRequest, unblockUser } from '@/app/actions/social';
import { LiveMessage } from '@/components/client-ui';
import { Button, Input, buttonClass } from '@/components/ui';

type P = { id: string; username: string; display_name: string; has_avatar?: boolean } | undefined;

function Who({ profile }: { profile: P }) {
  if (!profile) return <span className="text-muted">—</span>;
  return (
    <Link href={`/u/${profile.username}`} className="flex min-w-0 items-center gap-3 hover:underline">
      <Avatar userId={profile.id} name={profile.display_name || profile.username} hasImage={profile.has_avatar} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{profile.display_name || profile.username}</span>
        <span className="truncate text-sm text-muted">@{profile.username}</span>
      </span>
    </Link>
  );
}

export function FriendSearch({ existing }: { existing: string[] }) {
  const t = useTranslations('friends');
  const te = useTranslations('errors');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; username: string; display_name: string }[] | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setResults(await searchUsers(q)));
        }}
      >
        <label htmlFor="fq" className="sr-only">
          {t('searchLabel')}
        </label>
        <Input id="fq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} minLength={2} maxLength={40} autoCapitalize="none" />
        <button type="submit" className={buttonClass('primary')} disabled={pending || q.trim().length < 2}>
          {t('search')}
        </button>
      </form>
      {results && !results.length && <p className="text-muted">{t('noResults')}</p>}
      {!!results?.length && (
        <ul className="flex flex-col divide-y divide-line">
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <Who profile={r} />
              </div>
              {existing.includes(r.id) || sent.includes(r.id) ? (
                <span className="text-sm text-muted">{t('alreadyConnected')}</span>
              ) : (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await sendFriendRequest(r.id);
                      if (res.ok) {
                        setSent((s) => [...s, r.id]);
                        setMsg({ text: t('requestSent'), tone: 'success' });
                        router.refresh();
                      } else setMsg({ text: te(res.error), tone: 'error' });
                    })
                  }
                >
                  {t('add')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
    </section>
  );
}

export function FriendRow({ kind, friendshipId, profile }: { kind: 'incoming' | 'friend' | 'outgoing' | 'declined'; friendshipId: string; profile: P }) {
  const t = useTranslations('friends');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(te((res as { error: string }).error));
    });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="min-w-0 flex-1">
        <Who profile={profile} />
      </div>
      {kind === 'incoming' && (
        <>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => respondFriendRequest(friendshipId, true))}>
            {t('accept')}
          </Button>
          <Button size="sm" disabled={pending} onClick={() => act(() => respondFriendRequest(friendshipId, false))}>
            {t('decline')}
          </Button>
        </>
      )}
      {kind === 'friend' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => removeFriendship(friendshipId))}>
          {t('remove')}
        </Button>
      )}
      {kind === 'outgoing' && (
        <>
          <span className="text-sm text-muted">{t('pending')}</span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => removeFriendship(friendshipId))}>
            {t('cancel')}
          </Button>
        </>
      )}
      {kind === 'declined' && (
        <>
          <span className="text-sm text-muted">{t('declined')}</span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => removeFriendship(friendshipId))}>
            {t('clear')}
          </Button>
        </>
      )}
      {profile && kind !== 'declined' && (
        <Button size="sm" variant="ghost" className="text-tomato" disabled={pending} onClick={() => act(() => blockUser(profile.id))}>
          {t('block')}
        </Button>
      )}
      {error && <p className="w-full text-sm font-semibold text-tomato" role="alert">{error}</p>}
    </li>
  );
}

export function BlockedRow({ userId, profile }: { userId: string; profile: P }) {
  const t = useTranslations('friends');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="min-w-0 flex-1">
        <Who profile={profile} />
      </div>
      <Button size="sm" disabled={pending} onClick={() => start(async () => { await unblockUser(userId); router.refresh(); })}>
        {t('unblock')}
      </Button>
    </li>
  );
}
