import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Clock, Lock, Sparkles, Users } from 'lucide-react';
import type { RecipeListItem } from '@/lib/data/recipes';
import { categoryLabel, type CategoryRow } from '@/lib/recipes/categories';
import { RecipeImage } from './RecipeImage';
import { Badge } from '../ui';
import { StarsDisplay } from './StarsDisplay';
import { showRating } from '@/lib/recipes/rating';

export async function RecipeCard({ recipe, categories, showAuthor, priority }: { recipe: RecipeListItem; categories: CategoryRow[]; showAuthor?: boolean; priority?: boolean }) {
  const t = await getTranslations();
  const cat = categories.find((c) => c.id === recipe.category_id) ?? null;
  // Only the declared total: prep + cook may miss resting/rising times, so it is not shown as a total.
  const time = recipe.total_minutes;
  return (
    <article className="group relative flex w-full flex-col gap-3">
      <div className="aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-sunk shadow-[0_18px_30px_-22px_rgb(var(--shadow-color)/0.55)] group-has-[a:focus-visible]:outline-3 group-has-[a:focus-visible]:outline-offset-2 group-has-[a:focus-visible]:outline-[var(--focus)]">
        <RecipeImage imageId={recipe.coverImageId} title={recipe.title} className="h-full w-full motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]" priority={priority} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-0.5">
        <span className="text-[0.74rem] font-bold uppercase tracking-[0.14em] text-basil">{categoryLabel(cat, t)}</span>
        <h3 className="text-[1.12rem] font-semibold leading-snug sm:text-[1.3rem]">
          <Link href={`/recipes/${recipe.id}`} className="after:absolute after:inset-0 decoration-basil decoration-2 underline-offset-4 hover:underline focus-visible:outline-none">
            {recipe.title}
          </Link>
        </h3>
        {showAuthor && recipe.ownerUsername && <span className="text-sm text-muted">{t('card.by', { name: `@${recipe.ownerUsername}` })}</span>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
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
          {showRating(recipe) && <StarsDisplay avg={recipe.rating_avg!} count={recipe.rating_count} />}
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
  return <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-3">{children}</div>;
}
