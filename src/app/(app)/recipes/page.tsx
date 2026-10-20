import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import { listCategories, listMyRecipesPage, parseRecipeFilters } from '@/lib/data/recipes';
import { loadMoreMyRecipes } from '@/app/actions/pagination';
import { InfiniteList } from '@/components/recipes/InfiniteList';
import { categoryLabel } from '@/lib/recipes/categories';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { EmptyState, LadleMark, LinkButton, PageHeader, Select, buttonClass, inputClass } from '@/components/ui';

export async function generateMetadata() {
  const t = await getTranslations('recipes');
  return { title: t('title') };
}

type SP = { q?: string; category?: string; sort?: string; fav?: string; review?: string; tag?: string };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getTranslations();
  const sp = await searchParams;
  const filters = parseRecipeFilters(sp);
  const [categories, { items: recipes, nextCursor }] = await Promise.all([listCategories(), listMyRecipesPage(filters)]);
  const filtered = !!(filters.q || filters.category || filters.favorites || filters.review || filters.tag);

  return (
    <div>
      <PageHeader
        title={t('recipes.title')}
        lead={t('recipes.lead')}
        actions={
          <>
            <LinkButton href="/recipes/cooked">{t('cookLog.historyTitle')}</LinkButton>
            <LinkButton href="/recipes/new" variant="primary">
              {t('nav.addRecipe')}
            </LinkButton>
          </>
        }
      />

      <form method="get" role="search" className="mb-8 flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div className="flex gap-2">
          <label htmlFor="q" className="sr-only">
            {t('recipes.searchLabel')}
          </label>
          <input id="q" name="q" type="search" defaultValue={filters.q} placeholder={t('recipes.searchPlaceholder')} className={inputClass} />
          <button type="submit" className={buttonClass('primary', 'md', 'shrink-0')}>
            <Search aria-hidden className="size-5" />
            <span className="max-sm:sr-only">{t('common.search')}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-semibold">
            {t('recipes.category')}
            <Select name="category" defaultValue={filters.category ?? ''}>
              <option value="">{t('recipes.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c, t)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-semibold">
            {t('recipes.sort')}
            <Select name="sort" defaultValue={filters.sort}>
              <option value="recent">{t('recipes.sortRecent')}</option>
              <option value="updated">{t('recipes.sortUpdated')}</option>
              <option value="title">{t('recipes.sortTitle')}</option>
              <option value="quick">{t('recipes.sortQuick')}</option>
            </Select>
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="fav" value="1" defaultChecked={filters.favorites} className="size-5 accent-[var(--basil)]" />
            {t('recipes.onlyFavorites')}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="review" value="1" defaultChecked={filters.review} className="size-5 accent-[var(--basil)]" />
            {t('recipes.onlyReview')}
          </label>
          {filters.tag && <input type="hidden" name="tag" value={filters.tag} />}
          <button type="submit" className={buttonClass('secondary')}>
            {t('recipes.apply')}
          </button>
          {filtered && (
            <Link href="/recipes" className={buttonClass('ghost')}>
              {t('recipes.clearFilters')}
            </Link>
          )}
        </div>
      </form>

      <p className="mb-4 text-sm text-muted" aria-live="polite">
        {t(nextCursor ? 'recipes.resultsCountMore' : 'recipes.resultsCount', { count: recipes.length })}
        {filters.tag ? `, #${filters.tag}` : ''}
      </p>

      {recipes.length ? (
        <InfiniteList key={JSON.stringify(sp)} initialCursor={nextCursor} loadMore={loadMoreMyRecipes.bind(null, sp)}>
          <RecipeGrid>
            {recipes.map((r, i) => (
              <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor={filters.favorites} priority={i < 3} />
            ))}
          </RecipeGrid>
        </InfiniteList>
      ) : filtered ? (
        <EmptyState title={t('recipes.noResultsTitle')} action={<LinkButton href="/recipes">{t('recipes.clearFilters')}</LinkButton>}>
          {t('recipes.noResults')}
        </EmptyState>
      ) : (
        <EmptyState
          illustration={<LadleMark />}
          title={t('recipes.emptyTitle')}
          action={
            <>
              <LinkButton href="/recipes/new" variant="primary">
                {t('nav.addRecipe')}
              </LinkButton>
              <LinkButton href="/import/photo">{t('nav.importPhoto')}</LinkButton>
              <LinkButton href="/import/link">{t('nav.importLink')}</LinkButton>
            </>
          }
        >
          {t('recipes.empty')}
        </EmptyState>
      )}
    </div>
  );
}
