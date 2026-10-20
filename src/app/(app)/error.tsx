'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors');
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <Alert tone="error" title={t('pageTitle')} action={<Button variant="primary" onClick={reset}>{t('retry')}</Button>}>
        {t('pageLead')}
      </Alert>
    </div>
  );
}
