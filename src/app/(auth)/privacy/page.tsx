import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('privacy');
  return { title: t('title') };
}

const SECTIONS = ['data', 'visibility', 'photos', 'ai', 'keys', 'images', 'export', 'logs'] as const;

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8 sm:py-14">
      <h1 className="display-lg">{t('title')}</h1>
      <p className="text-muted">{t('lead')}</p>
      {SECTIONS.map((s) => (
        <section key={s} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">{t(`${s}Title`)}</h2>
          <p className="leading-relaxed">{t(s)}</p>
        </section>
      ))}
      <p className="text-sm text-muted">{t('operatorNote')}</p>
    </article>
  );
}
