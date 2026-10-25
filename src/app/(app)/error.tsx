'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors');
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <Alert tone="error" title={t('pageTitle')} action={<Button variant="primary" onClick={reset}>{t('retry')}</Button>}>
        {t('pageLead')}
      </Alert>
    </div>
  );
}
