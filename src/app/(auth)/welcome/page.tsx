import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Alert, LinkButton } from '@/components/ui';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const t = await getTranslations('welcome');
  const { deleted } = await searchParams;
  return (
    <div className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-16">
      <div className="flex flex-col gap-6">
        {deleted && <Alert tone="success">{t('deleted')}</Alert>}
        <h1 className="display-xl max-w-[12ch]">{t('title')}</h1>
        <p className="max-w-[46ch] text-lg text-muted">{t('lead')}</p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/signup" variant="primary" size="lg">
            {t('signup')}
          </LinkButton>
          <LinkButton href="/login" size="lg">
            {t('login')}
          </LinkButton>
        </div>
        <ul className="mt-4 grid max-w-xl gap-4 sm:grid-cols-3">
          {(['point1', 'point2', 'point3'] as const).map((p) => (
            <li key={p} className="flex flex-col gap-1 border-t-2 border-ink pt-3">
              <span className="font-display text-lg font-bold">{t(`${p}Title`)}</span>
              <span className="text-sm text-muted">{t(p)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-5">
          <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4">
            {t('terms')}
          </Link>
        </div>
      </div>

      {/* A recipe card drawn in HTML: the product's signature object */}
      <div aria-hidden className="relative mx-auto w-full max-w-md">
        <div className="absolute -left-4 -top-4 h-full w-full rotate-[-4deg] rounded-[var(--radius-card)] bg-saffron" />
        <div className="card-tab relative flex rotate-[1.5deg] flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-xl">
          <span className="text-sm font-semibold text-basil">{t('sampleCategory')}</span>
          <span className="display-lg">{t('sampleTitle')}</span>
          <div className="flex gap-4 text-sm text-muted">
            <span>{t('sampleTime')}</span>
            <span>{t('sampleServings')}</span>
          </div>
          <ul className="tabular flex flex-col divide-y divide-line text-[0.97rem]">
            {(['sampleIng1', 'sampleIng2', 'sampleIng3', 'sampleIng4'] as const).map((k) => (
              <li key={k} className="py-2">
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
