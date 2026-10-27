'use client';

import { useActionTransition } from '@/lib/run-action';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { addCollectionMember, removeCollectionMember, setCollectionVisibility } from '@/app/actions/organize';
import { Modal } from '@/components/client-ui';
import { Alert, Button, Field, Select } from '@/components/ui';

type Person = { id: string; name: string };
type Member = Person & { role: 'viewer' | 'editor' };

export function ShareCollection({ id, visibility, members, friends }: { id: string; visibility: 'private' | 'friends' | 'public'; members: Member[]; friends: Person[] }) {
  const t = useTranslations('collectionSharing');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [friend, setFriend] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useActionTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else setError(te((res.error ?? 'invalid_input') as never));
    });
  const invitable = friends.filter((f) => !members.some((m) => m.id === f.id));
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('share')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('title')} closeLabel={tc('close')}>
        <Field label={t('visibility')} htmlFor="cvis" hint={t(`hint_${visibility}`)}>
          <Select id="cvis" value={visibility} disabled={pending} onChange={(e) => run(() => setCollectionVisibility(id, e.target.value))}>
            <option value="private">{t('private')}</option>
            <option value="friends">{t('friends')}</option>
            <option value="public">{t('public')}</option>
          </Select>
        </Field>
        {visibility === 'public' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/collections/${id}`);
                  setCopied(true);
                } catch {
                  setError(t('copyFailed'));
                }
              }}
            >
              {copied ? t('copied') : t('copyLink')}
            </Button>
            <span className="text-sm text-muted">{t('linkNote')}</span>
          </div>
        )}
        <h3 className="font-bold">{t('members')}</h3>
        {members.length ? (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>
                  {m.name} <span className="text-sm text-muted">({t(m.role)})</span>
                </span>
                <Button size="sm" variant="ghost" className="text-tomato" disabled={pending} onClick={() => run(() => removeCollectionMember(id, m.id))}>
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('noMembers')}</p>
        )}
        {invitable.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('addFriend')} htmlFor="cfriend">
              <Select id="cfriend" value={friend} onChange={(e) => setFriend(e.target.value)}>
                <option value="">{t('chooseFriend')}</option>
                {invitable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('role')} htmlFor="crole">
              <Select id="crole" value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}>
                <option value="viewer">{t('viewer')}</option>
                <option value="editor">{t('editor')}</option>
              </Select>
            </Field>
            <Button variant="primary" disabled={pending || !friend} onClick={() => run(() => addCollectionMember(id, friend, role), () => setFriend(''))}>
              {t('invite')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">{t('noFriends')}</p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </Modal>
    </>
  );
}
