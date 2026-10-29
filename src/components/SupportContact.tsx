import { getTranslations } from 'next-intl/server';
import { supportEmail } from '@/lib/support';

export async function SupportContact() {
  const t = await getTranslations('support');
  const email = supportEmail();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{t('title')}</h2>
      {email ? (
        <p>
          {t.rich('lead', {
            email,
            link: (c) => (
              <a href={`mailto:${email}`} className="font-semibold text-terracotta-deep underline underline-offset-4">
                {c}
              </a>
            ),
          })}
        </p>
      ) : (
        <p className="text-muted">{t('notConfigured')}</p>
      )}
    </section>
  );
}
