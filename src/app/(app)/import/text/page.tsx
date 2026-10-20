import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';
import { TextImport } from './TextImport';

export async function generateMetadata() {
  const t = await getTranslations('textImport');
  return { title: t('title') };
}

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };

export default async function TextImportPage() {
  const [t, user, categories] = await Promise.all([getTranslations('textImport'), getUser(), editorCategories()]);
  const status = user ? await capabilityStatus(user.id, 'text', 'text').catch(() => NONE) : NONE;
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <TextImport categories={categories} status={status} />
    </div>
  );
}
