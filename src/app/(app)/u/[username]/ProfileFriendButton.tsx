'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { sendFriendRequest } from '@/app/actions/social';
import { Button, buttonClass } from '@/components/ui';

export function ProfileFriendButton({ userId, state }: { userId: string; state: 'none' | 'friends' | 'sent' | 'received' | 'declined' }) {
  const t = useTranslations('profile');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (state === 'friends') return null;
  if (state === 'sent' || state === 'declined') return <span className="text-muted">{t('requestPending')}</span>;
  if (state === 'received') return <Link href="/friends" className={buttonClass('primary')}>{t('answerRequest')}</Link>;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await sendFriendRequest(userId);
            if (res.ok) router.refresh();
            else setError(te(res.error));
          })
        }
      >
        {t('addFriend')}
      </Button>
      {error && <p className="text-sm text-tomato" role="alert">{error}</p>}
    </div>
  );
}
