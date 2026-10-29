import Link from 'next/link';
import Image, { type StaticImageData } from 'next/image';
import { getTranslations } from 'next-intl/server';
import { CalendarHeart, Camera, Link2, Lock, Type } from 'lucide-react';
import { Alert, LinkButton, cx } from '@/components/ui';
import hero from '@/assets/food/hero.webp';
import tagliatelle from '@/assets/food/tagliatelle.webp';
import salad from '@/assets/food/salad.webp';
import plate from '@/assets/food/plate.webp';

/** Decorative round food photo. */
function Round({ src, sizes, className }: { src: StaticImageData; sizes: string; className?: string }) {
  return (
    <div aria-hidden className={cx('aspect-square shrink-0', className)}>
      <Image src={src} alt="" sizes={sizes} placeholder="blur" className="size-full rounded-full object-cover shadow-[0_20px_34px_-22px_rgb(var(--shadow-color)/0.5)]" />
    </div>
  );
}

function Sprig() {
  return (
    <div aria-hidden className="flex items-center gap-3 text-basil before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
      <svg viewBox="0 0 22 16" className="h-4 w-6" fill="currentColor">
        <path d="M2 14C6 10 12 7 20 2" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <path d="M8 10c-1-3 0-6 3-7 1 3 0 6-3 7ZM14 6c0-3 2-5 5-5 0 3-2 5-5 5Z" />
      </svg>
    </div>
  );
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const t = await getTranslations('welcome');
  const { deleted } = await searchParams;
  const em = (c: React.ReactNode) => <em>{c}</em>;

  const features = [
    [Camera, t('point1Title')],
    [Lock, t('point2Title')],
    [CalendarHeart, t('point3Title')],
  ] as const;

  const sources = [
    [Camera, t('sourcePhoto')],
    [Link2, t('sourceLink')],
    [Type, t('sourceText')],
  ] as const;

  return (
    <div className="flex flex-1 flex-col gap-14 pb-4 sm:gap-20">
      {/* Hero: a full-bleed photo with a soft wave edge, then the promise and the two actions */}
      <section className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12 lg:pt-6">
        <div className="wave-b -mx-4 aspect-[1/0.86] overflow-hidden bg-sunk sm:mx-0 sm:aspect-[16/10] sm:rounded-t-[2rem] lg:order-2 lg:aspect-[1.05] lg:rounded-[50%_2.5rem_2.5rem_50%/60%_2.5rem_2.5rem_60%] lg:[mask:none]">
          <Image src={hero} alt="" sizes="(min-width: 1024px) 36rem, (min-width: 640px) 90vw, 100vw" placeholder="blur" fetchPriority="high" loading="eager" className="size-full object-cover" />
        </div>
        <div className="flex flex-col gap-5">
          {deleted && <Alert tone="success">{t('deleted')}</Alert>}
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1 className="display-xl max-w-[14ch]">{t.rich('title', { em })}</h1>
          <p className="max-w-[46ch] text-lg leading-relaxed sm:text-xl">{t('lead')}</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <LinkButton href="/signup" variant="primary" size="lg" className="flex-[1.5_1_auto] lg:flex-none">
              {t('signup')}
            </LinkButton>
            <LinkButton href="/login" size="lg" className="flex-[1_1_auto] lg:flex-none">
              {t('login')}
            </LinkButton>
          </div>
          <p className="flex items-center justify-center gap-2.5 text-[0.95rem] text-muted lg:justify-start">
            <Lock aria-hidden className="size-5 shrink-0 text-basil" />
            {t('privateNote')}
          </p>
        </div>
      </section>

      {/* The three promises as a quiet icon row */}
      <section className="flex flex-col gap-6">
        <Sprig />
        <ul className="grid grid-cols-3">
          {features.map(([Icon, label]) => (
            <li key={label} className="flex flex-col items-center gap-2 px-1.5 text-center font-semibold leading-tight text-ink [&+&]:border-l [&+&]:border-line">
              <Icon aria-hidden strokeWidth={1.6} className="size-8 sm:size-9" />
              {label}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works, finding recipes, the week */}
      <section className="grid gap-4 md:grid-cols-3 md:gap-5">
        <div className="flex flex-col gap-3 rounded-[2rem] bg-basil-wash p-6">
          <div className="grid grid-cols-[1fr_6.5rem] items-center gap-4">
            <div className="flex flex-col gap-2">
              <span className="eyebrow">{t('howTitle')}</span>
              <h2 className="text-[1.65rem] font-bold">{t('point1Title')}</h2>
            </div>
            <Round src={tagliatelle} sizes="7rem" />
          </div>
          <p>{t('point1')}</p>
          <div aria-hidden className="mt-auto flex flex-wrap gap-2 pt-1">
            {sources.map(([Icon, label]) => (
              <span key={label} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-sm font-semibold text-ink">
                <Icon className="size-4 shrink-0" />
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[2rem] bg-saffron-wash p-6">
          <div className="grid grid-cols-[1fr_6.5rem] items-center gap-4">
            <h2 className="text-[1.65rem] font-bold">{t('findTitle')}</h2>
            <Round src={salad} sizes="7rem" />
          </div>
          <p>{t('find')}</p>
        </div>
        <div className="flex flex-col gap-3 rounded-[2rem] bg-surface p-6 shadow-[var(--shadow-raised)]">
          <h2 className="text-[1.65rem] font-bold">{t('point3Title')}</h2>
          <p>{t('point3')}</p>
          <p className="text-muted">{t('point2')}</p>
        </div>
      </section>

      {/* Closing call to action under a second photo */}
      <section aria-labelledby="final-title" className="flex flex-col items-center gap-5 text-center">
        <div aria-hidden className="wave-t -mx-4 aspect-[1/0.62] self-stretch overflow-hidden bg-sunk sm:mx-0 sm:aspect-[21/8] sm:rounded-b-[2rem]">
          <Image src={plate} alt="" sizes="(min-width: 1152px) 72rem, 100vw" placeholder="blur" className="size-full object-cover" />
        </div>
        <h2 id="final-title" className="display-lg max-w-[20ch]">
          {t('finalTitle')}
        </h2>
        <p className="max-w-[48ch] text-lg">{t('finalLead')}</p>
        <LinkButton href="/signup" variant="primary" size="lg" className="w-full max-w-sm">
          {t('signup')}
        </LinkButton>
        <p className="flex flex-wrap items-center justify-center gap-x-2 text-muted">
          {t('haveAccount')}
          <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-terracotta-deep underline underline-offset-4">
            {t('login')}
          </Link>
        </p>
      </section>

      <footer className="flex flex-wrap justify-center gap-x-5 border-t border-line pt-4">
        <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-ink">
          {t('privacy')}
        </Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-ink">
          {t('terms')}
        </Link>
      </footer>
    </div>
  );
}
