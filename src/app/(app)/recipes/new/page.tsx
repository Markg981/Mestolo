import { getLocale, getTranslations } from 'next-intl/server';
import { RecipeEditor } from '@/components/recipes/editor/RecipeEditor';
import { emptyState } from '@/components/recipes/editor/convert';
import { draftNames } from '@/lib/drafts';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';

// Server action AI nella pagina: timeout provider fino a 120 s, quindi 150 s (piano Vercel da verificare).
export const maxDuration = 150;

export async function generateMetadata() {
  const t = await getTranslations('editor');
  return { title: t('newTitle') };
}

export default async function NewRecipePage() {
  const [t, locale, categories] = await Promise.all([getTranslations('editor'), getLocale(), editorCategories()]);
  return (
    <div>
      <PageHeader title={t('newTitle')} lead={t('newLead')} />
      <RecipeEditor mode="new" initial={emptyState(locale)} categories={categories} draftKey={draftNames.new} />
    </div>
  );
}
