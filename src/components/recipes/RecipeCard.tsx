import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Clock, Lock, Sparkles, Users } from 'lucide-react';
import type { RecipeListItem } from '@/lib/data/recipes';
import { categoryLabel, type CategoryRow } from '@/lib/recipes/categories';
import { RecipeImage } from './RecipeImage';
import { Badge } from '../ui';

export async function RecipeCard({ recipe, categories, showAuthor, priority }: { recipe: RecipeListItem; categories: CategoryRow[]; showAuthor?: boolean; priority?: boolean }) {
  const t = await getTranslations();
  const cat = categories.find((c) => c.id === recipe.category_id) ?? null;
  // Only the declared total: prep + cook may miss resting/rising times, so it is not shown as a total.
  const time = recipe.total_minutes;
  return (
    <article className="card-tab group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="aspect-[4/3] w-full overflow-hidden bg-sunk">
        <RecipeImage imageId={recipe.coverImageId} title={recipe.title} className="h-full w-full" priority={priority} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-sm font-semibold text-basil">{categoryLabel(cat, t)}</span>
        <h3 className="text-lg font-bold leading-snug">
          <Link href={`/recipes/${recipe.id}`} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
            {recipe.title}
          </Link>
        </h3>
        {showAuthor && recipe.ownerUsername && <span className="text-sm text-muted">{t('card.by', { name: `@${recipe.ownerUsername}` })}</span>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm text-muted">
          {time !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-4" />
              {t('card.minutes', { n: time })}
            </span>
          )}
          {recipe.servings && (
            <span className="inline-flex items-center gap-1">
              <Users aria-hidden className="size-4" />
              {t('card.servings', { n: Number(recipe.servings) })}
            </span>
          )}
          {!showAuthor && recipe.visibility === 'private' && (
            <span className="inline-flex items-center gap-1">
              <Lock aria-hidden className="size-4" />
              <span className="sr-only">{t('visibility.private')}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {recipe.verification_status === 'needs_review' && <Badge tone="saffron">{t('card.needsReview')}</Badge>}
          {recipe.coverKind === 'ai_generated' && (
            <Badge tone="neutral">
              <Sparkles aria-hidden className="size-3.5" />
              {t('card.aiImage')}
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
}

export function RecipeGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
