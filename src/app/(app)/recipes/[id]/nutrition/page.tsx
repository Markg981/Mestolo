import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { getRecipeDetail } from '@/lib/data/recipes';
import { getRecipeNutrition } from '@/lib/data/nutrition';
import { capabilityStatus } from '@/lib/ai/service';
import { NutritionEditor } from '@/components/nutrition/NutritionEditor';
import { PageHeader } from '@/components/ui';

export default async function NutritionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  if (!detail || !detail.isOwner) notFound();
  const user = await getUser();
  const [t, nutrition, status] = await Promise.all([
    getTranslations('nutrition'),
    getRecipeNutrition(id),
    user ? capabilityStatus(user.id, 'text', 'text').catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('editorTitle')} lead={t('editorLead', { title: detail.recipe.title })} />
      <NutritionEditor
        recipeId={id}
        initial={nutrition}
        initialSource={nutrition?.source ?? null}
        ai={{ available: !!status?.available, providerName: status?.providerName ?? null, remainingToday: status?.remainingToday ?? null }}
      />
      <Link href={`/recipes/${id}`} className="self-start font-semibold text-basil underline underline-offset-4">
        {t('back')}
      </Link>
    </div>
  );
}
