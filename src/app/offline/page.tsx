import { getTranslations } from 'next-intl/server';
import { LadleMark } from '@/components/ui';
import { RetryButton } from './RetryButton';

/** Static fallback shown by the service worker when there is no connection and no saved copy. */
export default async function OfflinePage() {
  const t = await getTranslations('offline');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-4">
      <LadleMark />
      <h1 className="display-lg">{t('title')}</h1>
      <p className="text-muted">{t('lead')}</p>
      <RetryButton label={t('retry')} />
    </main>
  );
}
