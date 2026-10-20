import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';
import { LinkImport } from './LinkImport';

export async function generateMetadata() {
  const t = await getTranslations('link');
  return { title: t('title') };
}

const NONE = { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };

export default async function LinkImportPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  const [t, user, categories] = await Promise.all([getTranslations('link'), getUser(), editorCategories()]);
  const status = user ? await capabilityStatus(user.id, 'text', 'text').catch(() => NONE) : NONE;
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <LinkImport categories={categories} status={status} initialUrl={url && /^https?:\/\//.test(url) ? url.slice(0, 2000) : ''} />
    </div>
  );
}
