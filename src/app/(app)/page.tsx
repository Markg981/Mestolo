import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Camera, Compass, Link2, Plus } from 'lucide-react';
import { getProfile, createClient, getUser } from '@/lib/supabase/server';
import { listCategories, listCollections, listMyRecipes } from '@/lib/data/recipes';
import { discover } from '@/lib/data/discover';
import { categoryLabel } from '@/lib/recipes/categories';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';
import { RecipeImage } from '@/components/recipes/RecipeImage';
import { Alert, EmptyState, LadleMark, LinkButton } from '@/components/ui';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const t = await getTranslations();
  const { password } = await searchParams;
  const [profile, user, categories] = await Promise.all([getProfile(), getUser(), listCategories()]);
  const [recent, review, collections, community] = await Promise.all([
    listMyRecipes({ limit: 6 }),
    listMyRecipes({ review: true, limit: 50 }),
    listCollections(),
    discover(categories, { limit: 60 }),
  ]);
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayPlan } = await supabase
    .from('meal_plan_entries')
    .select('id, slot, title, recipe_id')
    .eq('owner_id', user!.id)
    .eq('plan_date', today)
    .order('slot');

  const day = community.recipeOfTheDay;
  const dayCat = day ? categories.find((c) => c.id === day.category_id) ?? null : null;
  const name = profile?.display_name || profile?.username || '';

  const quick = [
    { href: '/recipes/new', icon: Plus, title: t('home.quickAdd'), desc: t('home.quickAddDesc') },
    { href: '/import/photo', icon: Camera, title: t('home.quickPhoto'), desc: t('home.quickPhotoDesc') },
    { href: '/import/link', icon: Link2, title: t('home.quickLink'), desc: t('home.quickLinkDesc') },
    { href: '/discover', icon: Compass, title: t('home.quickDiscover'), desc: t('home.quickDiscoverDesc') },
  ];

  return (
    <div className="flex flex-col gap-10 lg:gap-14">
      {password === 'updated' && <Alert tone="success">{t('home.passwordUpdated')}</Alert>}

      <section className="flex flex-col gap-5">
        <h1 className="display-lg">{name ? t('home.greeting', { name }) : t('home.greetingAnon')}</h1>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {quick.map((q, i) => (
            <Link
              key={q.href}
              href={q.href}
              className={`flex min-h-28 flex-col justify-between gap-3 rounded-[var(--radius-card)] border p-4 ${i === 0 ? 'border-transparent bg-saffron text-[#2a1a2e]' : 'border-line bg-surface hover:bg-sunk'}`}
            >
              <q.icon aria-hidden className="size-6" />
              <span className="flex flex-col">
                <span className="font-display text-lg font-bold leading-tight">{q.title}</span>
                <span className={`text-sm ${i === 0 ? 'text-[#2a1a2e]/80' : 'text-muted'}`}>{q.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="day-title" className="flex flex-col gap-4">
        <h2 id="day-title" className="text-2xl font-bold">
          {t('home.dayTitle')}
        </h2>
        {day ? (
          <Link href={`/recipes/${day.id}`} className="group grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface md:grid-cols-[1.1fr_1fr]">
            <div className="aspect-[16/10] w-full overflow-hidden bg-sunk md:aspect-auto md:min-h-80">
              <RecipeImage imageId={day.coverImageId} title={day.title} size="full" className="h-full w-full" priority />
            </div>
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
              <span className="text-sm font-semibold text-basil">{categoryLabel(dayCat, t)}</span>
              <span className="display-xl text-[clamp(2rem,5vw,3.6rem)] group-hover:underline">{day.title}</span>
              {day.description && <span className="line-clamp-3 text-muted">{day.description}</span>}
              <span className="text-sm text-muted">{t('home.dayFromCommunity', { name: day.ownerUsername ? `@${day.ownerUsername}` : '' })}</span>
            </div>
          </Link>
        ) : (
          <EmptyState title={t('home.dayEmptyTitle')} action={<LinkButton href="/friends">{t('home.dayEmptyAction')}</LinkButton>}>
            {t('home.dayEmpty')}
          </EmptyState>
        )}
      </section>

      {!!todayPlan?.length && (
        <section aria-labelledby="plan-title" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="plan-title" className="text-2xl font-bold">
              {t('home.todayPlanTitle')}
            </h2>
            <Link href="/plan" className="text-basil underline underline-offset-4">
              {t('home.openPlan')}
            </Link>
          </div>
          <ul className="flex flex-wrap gap-2">
            {todayPlan.map((e) => (
              <li key={e.id}>
                <Link href={e.recipe_id ? `/recipes/${e.recipe_id}` : '/plan'} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 hover:bg-sunk">
                  <span className="text-sm text-muted">{t(`plan.slots.${e.slot}`)}</span>
                  <span className="font-semibold">{e.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.length > 0 && (
        <Alert tone="warn" title={t('home.reviewTitle', { count: review.length })} action={<LinkButton href="/recipes?review=1" size="sm">{t('home.reviewAction')}</LinkButton>}>
          {t('home.reviewLead')}
        </Alert>
      )}

      <section aria-labelledby="recent-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-title" className="text-2xl font-bold">
            {t('home.recentTitle')}
          </h2>
          {recent.length > 0 && (
            <Link href="/recipes" className="text-basil underline underline-offset-4">
              {t('home.seeAll')}
            </Link>
          )}
        </div>
        {recent.length ? (
          <RecipeGrid>
            {recent.map((r) => (
              <RecipeCard key={r.id} recipe={r} categories={categories} />
            ))}
          </RecipeGrid>
        ) : (
          <EmptyState
            illustration={<LadleMark />}
            title={t('home.recentEmptyTitle')}
            action={
              <>
                <LinkButton href="/recipes/new" variant="primary">
                  {t('nav.addRecipe')}
                </LinkButton>
                <LinkButton href="/import/link">{t('nav.importLink')}</LinkButton>
              </>
            }
          >
            {t('home.recentEmpty')}
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="col-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="col-title" className="text-2xl font-bold">
            {t('home.collectionsTitle')}
          </h2>
          <Link href="/collections" className="text-basil underline underline-offset-4">
            {t('home.manage')}
          </Link>
        </div>
        {collections.length ? (
          <ul className="flex flex-wrap gap-2">
            {collections.slice(0, 10).map((c) => (
              <li key={c.id}>
                <Link href={`/collections/${c.id}`} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 font-semibold hover:bg-sunk">
                  {c.name}
                  <span className="tabular text-sm font-normal text-muted">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('home.collectionsEmpty')}</p>
        )}
      </section>
    </div>
  );
}
