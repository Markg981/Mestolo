import Link from 'next/link';
import Image, { type StaticImageData } from 'next/image';
import { getTranslations } from 'next-intl/server';
import { CalendarDays, Camera, Globe, Laptop, Link2, Lock, Scale, Search, ShoppingBasket, Smartphone, Tablet, Type, Users } from 'lucide-react';
import { Alert, LinkButton, cx } from '@/components/ui';
import bowl from '@/assets/food/bowl.webp';
import farfalle from '@/assets/food/farfalle.webp';
import tagliatelle from '@/assets/food/tagliatelle.webp';
import vegetables from '@/assets/food/vegetables.webp';
import salad from '@/assets/food/salad.webp';
import plate from '@/assets/food/plate.webp';

/** Decorative round food photo; `plate` adds the offset honey disc behind it. */
function Round({ src, sizes, className, disc, eager }: { src: StaticImageData; sizes: string; className?: string; disc?: boolean; eager?: boolean }) {
  return (
    <div aria-hidden className={cx('aspect-square shrink-0', disc && 'plate', className)}>
      <Image
        src={src}
        alt=""
        sizes={sizes}
        placeholder="blur"
        fetchPriority={eager ? 'high' : undefined}
        loading={eager ? 'eager' : undefined}
        className="size-full rounded-full object-cover shadow-[0_24px_40px_-24px_rgb(var(--shadow-color)/0.5)]"
      />
    </div>
  );
}

function Chip({ icon: Icon, children, active }: { icon: typeof Camera; children: React.ReactNode; active?: boolean }) {
  return (
    <span className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold', active ? 'bg-basil text-on-accent' : 'bg-surface text-ink')}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const t = await getTranslations('welcome');
  const tv = await getTranslations('visibility');
  const tr = await getTranslations('recipes');
  const { deleted } = await searchParams;
  const em = (c: React.ReactNode) => <em>{c}</em>;

  const sources = [
    [farfalle, Camera, t('sourcePhoto')],
    [tagliatelle, Link2, t('sourceLink')],
    [vegetables, Type, t('sourceText')],
  ] as const;

  return (
    <div className="flex flex-1 flex-col gap-16 pb-4 sm:gap-24">
      {/* Hero: a round plate photo leads, the promise and the two actions follow */}
      <section className="relative grid items-center gap-6 pt-2 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pt-10">
        <div className="relative -mr-14 -mt-2 w-[16rem] justify-self-end sm:-mr-8 sm:w-[20rem] lg:order-2 lg:mr-0 lg:w-full lg:max-w-[30rem]">
          <Round src={bowl} disc eager sizes="(min-width: 1024px) 30rem, 17rem" className="w-full" />
          <Round src={tagliatelle} sizes="(min-width: 1024px) 11rem, 7.5rem" className="absolute -bottom-4 -left-24 w-[7.5rem] rounded-full ring-[6px] ring-porcelain sm:-left-28 sm:w-[9rem] lg:-left-10 lg:w-[11rem]" />
        </div>
        <div className="flex flex-col gap-5">
          {deleted && <Alert tone="success">{t('deleted')}</Alert>}
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1 className="display-xl max-w-[13ch]">{t.rich('title', { em })}</h1>
          <p className="max-w-[44ch] text-lg leading-relaxed text-muted sm:text-xl">{t('lead')}</p>
          <div className="mt-1 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:flex-wrap">
            <LinkButton href="/signup" variant="primary" size="lg">
              {t('signup')}
            </LinkButton>
            <LinkButton href="/login" size="lg">
              {t('login')}
            </LinkButton>
          </div>
        </div>
      </section>

      {/* Import: a solid sage band with the three sources as round photos */}
      <section aria-labelledby="how-title" className="-mx-4 bg-basil px-6 pb-12 pt-16 text-on-accent [clip-path:polygon(0_2.5rem,100%_0,100%_100%,0_100%)] sm:mx-0 sm:rounded-b-[2rem] sm:px-10 sm:pt-20">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="flex max-w-xl flex-col gap-3">
            <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-on-accent/85">{t('howTitle')}</span>
            <h2 id="how-title" className="display-lg">
              {t('point1Title')}
            </h2>
            <p className="text-lg text-on-accent/90">{t('point1')}</p>
          </div>
          <ul aria-hidden className="grid grid-cols-3 gap-3 sm:gap-6 lg:shrink-0">
            {sources.map(([src, Icon, label]) => (
              <li key={label} className="flex flex-col items-center gap-3">
                <Round src={src} sizes="(min-width: 640px) 8rem, 6rem" className="w-full max-w-[8rem] rounded-full ring-4 ring-on-accent/25" />
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Icon className="size-4 shrink-0" />
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Find and privacy */}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-sunk p-6 sm:p-8">
          <h2 className="text-3xl font-semibold">{t('findTitle')}</h2>
          <p className="text-muted">{t('find')}</p>
          <div aria-hidden className="mt-auto flex flex-col gap-4 pt-2">
            <span className="flex min-h-12 items-center gap-2 rounded-full bg-surface px-4 text-muted shadow-[var(--shadow-card)]">
              <Search className="size-5 shrink-0 text-basil" />
              <span className="truncate">{tr('searchPlaceholder')}</span>
            </span>
            <span className="flex gap-3 text-basil">
              <Smartphone className="size-6" />
              <Tablet className="size-6" />
              <Laptop className="size-6" />
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-basil-wash p-6 sm:p-8">
          <h2 className="text-3xl font-semibold">{t('point2Title')}</h2>
          <p className="text-muted">{t('point2')}</p>
          <div aria-hidden className="mt-auto flex flex-wrap gap-2 pt-2">
            <Chip icon={Lock} active>
              {tv('private')}
            </Chip>
            <Chip icon={Users}>{tv('friends')}</Chip>
            <Chip icon={Globe}>{tv('public')}</Chip>
          </div>
        </div>
      </section>

      {/* The week: honey block with a plate bleeding off the edge */}
      <section aria-labelledby="week-title" className="relative overflow-hidden rounded-[2rem] bg-saffron-wash">
        <div className="relative z-10 flex max-w-[34rem] flex-col gap-4 p-6 pb-48 sm:p-10 sm:pb-10 sm:pr-[15rem] md:max-w-none md:pr-[22rem]">
          <h2 id="week-title" className="display-lg">
            {t('point3Title')}
          </h2>
          <p className="text-lg">{t('point3')}</p>
          <div aria-hidden className="flex gap-3">
            {[CalendarDays, ShoppingBasket, Scale].map((Icon, i) => (
              <span key={i} className="flex size-14 items-center justify-center rounded-full bg-surface text-saffron-deep shadow-[var(--shadow-card)]">
                <Icon className="size-6" />
              </span>
            ))}
          </div>
        </div>
        <Round src={salad} sizes="(min-width: 768px) 22rem, 15rem" className="absolute -bottom-14 -right-10 w-[15rem] sm:-bottom-10 sm:top-1/2 sm:w-[17rem] sm:-translate-y-1/2 md:w-[22rem] md:-right-12" />
      </section>

      {/* Closing call to action */}
      <section aria-labelledby="final-title" className="flex flex-col items-center gap-5 px-2 py-6 text-center">
        <Round src={plate} disc sizes="10rem" className="mb-2 w-40" />
        <h2 id="final-title" className="display-lg max-w-[20ch]">
          {t('finalTitle')}
        </h2>
        <p className="max-w-[48ch] text-lg text-muted">{t('finalLead')}</p>
        <LinkButton href="/signup" variant="primary" size="lg" className="w-full max-w-xs">
          {t('signup')}
        </LinkButton>
        <p className="flex flex-wrap items-center justify-center gap-x-2 text-muted">
          {t('haveAccount')}
          <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-basil underline underline-offset-4">
            {t('login')}
          </Link>
        </p>
      </section>

      <footer className="flex flex-wrap gap-x-5 border-t border-line pt-4">
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
