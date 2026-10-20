import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';
import { PhotoImport } from './PhotoImport';

export async function generateMetadata() {
  const t = await getTranslations('photo');
  return { title: t('title') };
}

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };

export default async function PhotoImportPage() {
  const [t, user, categories] = await Promise.all([getTranslations('photo'), getUser(), editorCategories()]);
  const status = user ? await capabilityStatus(user.id, 'vision', 'vision').catch(() => NONE) : NONE;
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <PhotoImport categories={categories} status={status} />
    </div>
  );
}
