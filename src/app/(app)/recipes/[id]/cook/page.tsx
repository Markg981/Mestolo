import { notFound } from 'next/navigation';
import { getRecipeDetail } from '@/lib/data/recipes';
import { CookMode } from '@/components/cooking/CookMode';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getRecipeDetail(id);
  return { title: d?.recipe.title ?? 'Mestolo' };
}

export default async function CookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  if (!detail) notFound();
  const { recipe } = detail;
  return <CookMode recipeId={id} title={recipe.title} ingredients={recipe.ingredients ?? []} steps={recipe.steps ?? []} />;
}
