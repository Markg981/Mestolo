import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@/components/ui';
import { FeedbackForm } from './FeedbackForm';

export async function generateMetadata() {
  const t = await getTranslations('feedback');
  return { title: t('title') };
}

export default async function FeedbackPage() {
  const t = await getTranslations('feedback');
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        back={
          <Link href="/settings" className="text-basil underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      <Card>
        <FeedbackForm appVersion={process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.npm_package_version ?? ''} />
      </Card>
    </div>
  );
}
