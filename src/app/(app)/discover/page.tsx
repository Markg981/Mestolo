import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCategories } from '@/lib/data/recipes';
import { discover } from '@/lib/data/discover';
import { listFeed } from '@/lib/data/feed';
import { FeedGrid } from '@/components/recipes/FeedGrid';
import { loadMoreDiscover, loadMoreFeed } from '@/app/actions/pagination';
import { InfiniteList } from '@/components/recipes/InfiniteList';
import { categoryLabel } from '@/lib/recipes/categories';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { RecipeImage } from '@/components/recipes/RecipeImage';
import { EmptyState, LinkButton, PageHeader, cx } from '@/components/ui';

export async function generateMetadata() {
  const t = await getTranslations('discover');
  return { title: t('title') };
}

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ category?: string; tab?: string }> }) {
  const t = await getTranslations();
  const sp = await searchParams;
  const categories = await listCategories();
  const systemCats = categories.filter((c) => c.owner_id === null);
  const recent = sp.tab === 'recent';
  const active = sp.category && systemCats.some((c) => c.id === sp.category) ? sp.category : undefined;
  const feed = recent ? null : await listFeed();
  const { items, hiddenByPreferences, recipeOfTheDay, nextCursor } = recent
    ? await discover(categories, { category: active })
    : { items: [], hiddenByPreferences: 0, recipeOfTheDay: null, nextCursor: null };
  const day = recent && !active ? recipeOfTheDay : null;
  const rest = items.filter((r) => r.id !== day?.id);
  const tabClass = (on: boolean) => cx('flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold', on ? 'border-ink bg-ink text-porcelain' : 'border-line bg-surface hover:bg-sunk');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('discover.title')} lead={t('discover.lead')} />

      <nav aria-label={t('feed.tabs')}>
        <ul className="flex gap-2">
          <li>
            <Link href="/discover" aria-current={!recent ? 'page' : undefined} className={tabClass(!recent)}>
              {t('feed.forYou')}
            </Link>
          </li>
          <li>
            <Link href="/discover?tab=recent" aria-current={recent ? 'page' : undefined} className={tabClass(recent)}>
              {t('feed.recent')}
            </Link>
          </li>
        </ul>
      </nav>

      {feed && (
        feed.items.length ? (
          <>
            {!feed.personalized && (
              <p className="rounded-[var(--radius-card)] border border-line bg-sunk p-4 text-sm text-muted">{t('feed.coldStart')}</p>
            )}
            <InfiniteList initialCursor={feed.nextCursor} loadMore={loadMoreFeed}>
              <FeedGrid items={feed.items} categories={categories} />
            </InfiniteList>
          </>
        ) : (
          <EmptyState
            title={t('feed.emptyTitle')}
            action={
              <>
                <LinkButton href="/friends" variant="primary">
                  {t('discover.findFriends')}
                </LinkButton>
                <LinkButton href="/discover?tab=recent">{t('feed.seeRecent')}</LinkButton>
              </>
            }
          >
            {t('feed.empty')}
          </EmptyState>
        )
      )}

      {recent && <nav aria-label={t('discover.filters')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1">
          <li>
            <Link href="/discover?tab=recent" aria-current={!active ? 'page' : undefined} className={cx('flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold', !active ? 'border-ink bg-ink text-porcelain' : 'border-line bg-surface hover:bg-sunk')}>
              {t('discover.all')}
            </Link>
          </li>
          {systemCats.map((c) => (
            <li key={c.id}>
              <Link href={`/discover?tab=recent&category=${c.id}`} aria-current={active === c.id ? 'page' : undefined} className={cx('flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold', active === c.id ? 'border-ink bg-ink text-porcelain' : 'border-line bg-surface hover:bg-sunk')}>
                {categoryLabel(c, t)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>}

      {day && (
        <section aria-labelledby="dotd" className="flex flex-col gap-3">
          <h2 id="dotd" className="text-2xl font-bold">
            {t('discover.dayTitle')}
          </h2>
          <Link href={`/recipes/${day.id}`} className="group grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface md:grid-cols-2">
            <div className="aspect-[16/10] overflow-hidden bg-sunk md:aspect-auto md:min-h-72">
              <RecipeImage imageId={day.coverImageId} title={day.title} size="full" className="h-full w-full" priority />
            </div>
            <div className="flex flex-col justify-center gap-3 p-6">
              <span className="display-lg group-hover:underline">{day.title}</span>
              {day.description && <span className="line-clamp-3 text-muted">{day.description}</span>}
              {day.ownerUsername && <span className="text-sm text-muted">{t('card.by', { name: `@${day.ownerUsername}` })}</span>}
            </div>
          </Link>
        </section>
      )}

      {hiddenByPreferences > 0 && (
        <p className="text-sm text-muted">
          {t('discover.filteredNote', { n: hiddenByPreferences })}{' '}
          <Link href="/settings" className="text-terracotta-deep underline underline-offset-4">
            {t('discover.preferencesLink')}
          </Link>
        </p>
      )}

      {recent && (rest.length ? (
        <InfiniteList key={active ?? 'all'} initialCursor={nextCursor} loadMore={loadMoreDiscover.bind(null, { category: active })}>
          <RecipeGrid>
            {rest.map((r) => (
              <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor />
            ))}
          </RecipeGrid>
        </InfiniteList>
      ) : !day ? (
        <EmptyState
          title={t('discover.emptyTitle')}
          action={
            <>
              <LinkButton href="/friends" variant="primary">
                {t('discover.findFriends')}
              </LinkButton>
              <LinkButton href="/recipes">{t('discover.shareYours')}</LinkButton>
            </>
          }
        >
          {active ? t('discover.emptyCategory') : t('discover.empty')}
        </EmptyState>
      ) : null)}
    </div>
  );
}
