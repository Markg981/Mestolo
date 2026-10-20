import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { Leaf } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { LIST_COLUMNS, attachCovers, type RecipeListItem } from '@/lib/data/recipes';
import type { Ingredient } from '@/lib/recipes/types';
import { isLocale } from '@/i18n/config';
import { HEMISPHERE_COOKIE, guessHemisphere, isHemisphere, productsInSeason, rankSeasonalRecipes } from '@/lib/seasonal';
import { Badge } from '../ui';
import { RecipeImage } from '../recipes/RecipeImage';
import { HemisphereToggle } from './HemisphereToggle';

type Row = Omit<RecipeListItem, 'coverImageId' | 'coverKind'> & { ingredients: Ingredient[] | null };

/** "Di stagione" block for the home: products of the month + visible recipes (RLS) using the most of them. */
export async function SeasonalSection() {
  const [t, localeRaw, jar, hdrs] = await Promise.all([getTranslations('seasonal'), getLocale(), cookies(), headers()]);
  const locale = isLocale(localeRaw) ? localeRaw : 'it';
  const saved = jar.get(HEMISPHERE_COOKIE)?.value;
  const hemisphere = isHemisphere(saved) ? saved : guessHemisphere(hdrs.get('accept-language'));
  const month = new Date().getMonth() + 1;
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2024, month - 1, 1));

  const products = productsInSeason(month, hemisphere);
  const label = (p: (typeof products)[number]) => {
    const n = p.names[locale][0] ?? p.id;
    return n.charAt(0).toUpperCase() + n.slice(1);
  };

  const supabase = await createClient();
  const { data } = await supabase
    .from('recipes')
    .select(`${LIST_COLUMNS}, ingredients`)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(150);
  const rows = ((data as unknown as Row[]) ?? []).map((r) => ({ ...r, ingredients: r.ingredients ?? [] }));
  const ranked = rankSeasonalRecipes(rows, month, hemisphere, { limit: 3 });
  const covers = await attachCovers(ranked.map((x) => x.recipe));

  const groups = [
    { key: 'vegetables', items: products.filter((p) => p.kind === 'vegetable') },
    { key: 'fruit', items: products.filter((p) => p.kind === 'fruit') },
  ];

  return (
    <section aria-labelledby="seasonal-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="seasonal-title" className="flex items-center gap-2 text-2xl font-bold">
          <Leaf aria-hidden className="size-6 text-basil" />
          {t('title', { month: monthName })}
        </h2>
        <HemisphereToggle value={hemisphere} />
      </div>
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted">{t(g.key)}</h3>
            <ul className="flex flex-wrap gap-2">
              {g.items.map((p) => (
                <li key={p.id}>
                  <Badge tone="basil">{label(p)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted">{t('note')}</p>
      </div>
      <h3 className="text-lg font-bold">{t('recipesTitle')}</h3>
      {ranked.length ? (
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          {ranked.map(({ score }, i) => {
            const r = covers[i];
            return (
              <li key={r.id} className="relative flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                <RecipeImage imageId={r.coverImageId} title={r.title} className="size-16 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-col gap-1">
                  <Link href={`/recipes/${r.id}`} className="font-bold leading-snug after:absolute after:inset-0 hover:underline focus-visible:outline-none">
                    {r.title}
                  </Link>
                  <span className="text-sm text-basil">{t('uses', { count: score.products.length })}</span>
                  <span className="truncate text-sm text-muted">{score.products.map(label).join(', ')}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">{t('noRecipes')}</p>
      )}
    </section>
  );
}
