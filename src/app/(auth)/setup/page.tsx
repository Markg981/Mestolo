import { getTranslations } from 'next-intl/server';
import { isSupabaseConfigured } from '@/lib/env';
import { Alert, LinkButton } from '@/components/ui';

/** Shown when the deployment has no Supabase configuration yet. */
export default async function SetupPage() {
  const t = await getTranslations('setup');
  const configured = isSupabaseConfigured();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8 sm:py-14">
      <h1 className="display-lg">{t('title')}</h1>
      {configured ? (
        <Alert tone="success" title={t('readyTitle')} action={<LinkButton href="/welcome" variant="primary">{t('open')}</LinkButton>} />
      ) : (
        <>
          <p className="text-muted">{t('lead')}</p>
          <ol className="flex list-decimal flex-col gap-3 pl-6">
            <li>{t('step1')}</li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
            <li>{t('step4')}</li>
          </ol>
          <Alert tone="info">{t('docs')}</Alert>
        </>
      )}
    </div>
  );
}
