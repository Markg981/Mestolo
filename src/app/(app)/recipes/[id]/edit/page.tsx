import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRecipeDetail } from '@/lib/data/recipes';
import { editorCategories, unitLabeler } from '@/lib/data/editor';
import { RecipeEditor } from '@/components/recipes/editor/RecipeEditor';
import { stateFromRecipe } from '@/components/recipes/editor/convert';
import { ImageManager } from '@/components/recipes/ImageManager';
import { draftNames } from '@/lib/drafts';
import { PageHeader } from '@/components/ui';

// Server action AI nella pagina: timeout provider fino a 120 s, quindi 150 s (piano Vercel da verificare).
export const maxDuration = 150;

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  if (!detail || !detail.isOwner) notFound();
  const [t, categories, unitLabel] = await Promise.all([getTranslations('editor'), editorCategories(), unitLabeler()]);
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={t('editTitle')} lead={t('editLead')} />
      <ImageManager recipeId={id} title={detail.recipe.title} images={detail.images} />
      <RecipeEditor mode="edit" recipeId={id} initial={stateFromRecipe(detail.recipe, detail.note, unitLabel)} categories={categories} draftKey={draftNames.edit(id)} baseVersion={detail.recipe.content_hash} expectedVersion={detail.recipe.version} />
    </div>
  );
}
