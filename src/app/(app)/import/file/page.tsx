import { getTranslations } from 'next-intl/server';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';
import { FileImport } from './FileImport';

// Server action AI nella pagina: timeout provider fino a 120 s, quindi 150 s (piano Vercel da verificare).
export const maxDuration = 150;

export async function generateMetadata() {
  const t = await getTranslations('fileImport');
  return { title: t('title') };
}

export default async function FileImportPage() {
  const [t, categories] = await Promise.all([getTranslations('fileImport'), editorCategories()]);
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <FileImport categories={categories} />
    </div>
  );
}
