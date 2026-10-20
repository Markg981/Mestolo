'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { addShoppingMember, removeShoppingMember, renameShoppingList } from '@/app/actions/shopping';
import { LiveMessage } from '@/components/client-ui';
import { Button, Input, Select } from '@/components/ui';

interface Person {
  id: string;
  name: string;
}

export function ShoppingMembers({
  listId,
  listName,
  isOwner,
  ownerName,
  me,
  lists,
  members,
  friends,
}: {
  listId: string;
  listName: string;
  isOwner: boolean;
  ownerName: string;
  me: string;
  lists: { id: string; label: string }[];
  members: Person[];
  friends: Person[];
}) {
  const t = useTranslations('shopping');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState('');
  const [name, setName] = useState(listName);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ text: okText, tone: 'success' });
        after?.();
        router.refresh();
      } else setMsg({ text: te((res.error ?? 'generic') as 'generic'), tone: 'error' });
    });

  const invitable = friends.filter((f) => !members.some((m) => m.id === f.id));

  return (
    <section aria-labelledby="family" className="no-print flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="family" className="text-lg font-bold">
          {t('familyTitle')}
        </h2>
        {lists.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="listpick" className="text-sm text-muted">
              {t('listSwitch')}
            </label>
            <Select id="listpick" value={listId} onChange={(e) => router.push(`/shopping?list=${e.target.value}`)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {!isOwner && <p className="text-sm text-muted">{t('sharedBy', { name: ownerName })}</p>}

      {members.length === 0 ? (
        isOwner && <p className="text-sm text-muted">{t('membersNone')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-sm">
              <span>{m.id === me ? t('you') : m.name}</span>
              {isOwner && (
                <button
                  type="button"
                  className="ml-1 min-h-6 min-w-6 text-muted hover:text-ink"
                  aria-label={t('removeMember', { name: m.name })}
                  disabled={pending}
                  onClick={() => run(() => removeShoppingMember(listId, m.id), t('memberRemoved'))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner ? (
        <>
          {invitable.length > 0 ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (pick) run(() => addShoppingMember(listId, pick), t('memberAdded'), () => setPick(''));
              }}
            >
              <label htmlFor="invitepick" className="sr-only">
                {t('inviteLabel')}
              </label>
              <Select id="invitepick" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{t('invitePick')}</option>
                {invitable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" disabled={pending || !pick}>
                {t('inviteButton')}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">{t('noFriends')}</p>
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) run(() => renameShoppingList(listId, name), t('renamed'));
            }}
          >
            <label htmlFor="listname" className="sr-only">
              {t('renameLabel')}
            </label>
            <Input id="listname" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('defaultName')} maxLength={80} />
            <Button type="submit" variant="ghost" disabled={pending || !name.trim() || name.trim() === listName}>
              {t('renameButton')}
            </Button>
          </form>
        </>
      ) : (
        <div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(
                () => removeShoppingMember(listId, me),
                t('left'),
                () => router.push('/shopping'),
              )
            }
          >
            {t('leave')}
          </Button>
        </div>
      )}
      <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
    </section>
  );
}
