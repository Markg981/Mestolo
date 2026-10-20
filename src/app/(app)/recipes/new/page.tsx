import { getLocale, getTranslations } from 'next-intl/server';
import { RecipeEditor } from '@/components/recipes/editor/RecipeEditor';
import { emptyState } from '@/components/recipes/editor/convert';
import { editorCategories } from '@/lib/data/editor';
import { PageHeader } from '@/components/ui';

export async function generateMetadata() {
  const t = await getTranslations('editor');
  return { title: t('newTitle') };
}

export default async function NewRecipePage() {
  const [t, locale, categories] = await Promise.all([getTranslations('editor'), getLocale(), editorCategories()]);
  return (
    <div>
      <PageHeader title={t('newTitle')} lead={t('newLead')} />
      <RecipeEditor mode="new" initial={emptyState(locale)} categories={categories} draftKey="mestolo:draft:new" />
    </div>
  );
}
