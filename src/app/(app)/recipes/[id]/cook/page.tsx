import { notFound } from 'next/navigation';
import { getRecipeDetail } from '@/lib/data/recipes';
import { getUser } from '@/lib/supabase/server';
import { capabilityStatus } from '@/lib/ai/service';
import { CookMode } from '@/components/cooking/CookMode';

// Server action AI nella pagina: timeout provider fino a 120 s, quindi 150 s (piano Vercel da verificare).
export const maxDuration = 150;

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
  const user = await getUser();
  const status = user ? await capabilityStatus(user.id, 'text', 'text').catch(() => null) : null;
  return (
    <CookMode
      recipeId={id}
      title={recipe.title}
      ingredients={recipe.ingredients ?? []}
      steps={recipe.steps ?? []}
      servings={recipe.servings === null ? null : Number(recipe.servings)}
      assistantAvailable={!!status?.available}
    />
  );
}
