import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LadleMark, buttonClass } from '@/components/ui';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-4">
      <LadleMark />
      <h1 className="display-lg">{t('notFoundTitle')}</h1>
      <p className="text-muted">{t('notFoundLead')}</p>
      <Link href="/" className={buttonClass('primary')}>
        {t('goHome')}
      </Link>
    </main>
  );
}
