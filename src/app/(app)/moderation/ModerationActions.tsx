'use client';

import { useActionTransition } from '@/lib/run-action';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { moderateReport } from '@/app/actions/moderation';
import { Button } from '@/components/ui';

export function ModerationActions({ reportId, hidden, onlyRestore }: { reportId: string; hidden: boolean; onlyRestore?: boolean }) {
  const t = useTranslations('moderation');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (a: 'hide' | 'restore' | 'dismiss') =>
    start(async () => {
      setError(null);
      const res = await moderateReport(reportId, a);
      if (res.ok) router.refresh();
      else setError(te(res.error));
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!onlyRestore && !hidden && (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => act('hide')}>
          {t('hide')}
        </Button>
      )}
      {hidden && (
        <Button size="sm" disabled={pending} onClick={() => act('restore')}>
          {t('restore')}
        </Button>
      )}
      {!onlyRestore && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act('dismiss')}>
          {t('dismiss')}
        </Button>
      )}
      {error && <p className="w-full text-sm font-semibold text-tomato" role="alert">{error}</p>}
    </div>
  );
}
