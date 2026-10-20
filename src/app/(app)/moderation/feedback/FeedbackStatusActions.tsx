'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setFeedbackStatus } from '@/app/actions/feedback';
import { Button } from '@/components/ui';

export function FeedbackStatusActions({ id, status }: { id: string; status: 'new' | 'seen' | 'done' }) {
  const t = useTranslations('feedback');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (s: 'new' | 'seen' | 'done') =>
    start(async () => {
      setError(null);
      const res = await setFeedbackStatus(id, s);
      if (res.ok) router.refresh();
      else setError(te(res.error));
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'seen' && (
        <Button size="sm" disabled={pending} onClick={() => set('seen')}>
          {t('markSeen')}
        </Button>
      )}
      {status !== 'done' && (
        <Button size="sm" variant="primary" disabled={pending} onClick={() => set('done')}>
          {t('markDone')}
        </Button>
      )}
      {status !== 'new' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set('new')}>
          {t('reopen')}
        </Button>
      )}
      {error && (
        <p className="w-full text-sm font-semibold text-tomato" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
