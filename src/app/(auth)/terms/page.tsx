import { getTranslations } from 'next-intl/server';
import { SupportContact } from '@/components/SupportContact';
import { LegalController } from '@/components/LegalController';
import { TERMS_SECTIONS as SECTIONS } from '@/lib/legal';

export async function generateMetadata() {
  const t = await getTranslations('terms');
  return { title: t('title') };
}

export default async function TermsPage() {
  const t = await getTranslations('terms');
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8 sm:py-14">
      <h1 className="display-lg">{t('title')}</h1>
      <p className="text-muted">{t('lead')}</p>
      <LegalController />
      {SECTIONS.map((s) => (
        <section key={s} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">{t(`${s}Title`)}</h2>
          <p className="leading-relaxed">{t(s)}</p>
        </section>
      ))}
      <SupportContact />
      <p className="text-sm text-muted">{t('updated')}</p>
    </article>
  );
}
