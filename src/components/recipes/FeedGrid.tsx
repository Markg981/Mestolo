import { getTranslations } from 'next-intl/server';
import type { CategoryRow } from '@/lib/recipes/categories';
import { categoryLabel } from '@/lib/recipes/categories';
import type { FeedItem, FeedReason } from '@/lib/data/feed';
import { RecipeCard, RecipeGrid } from './RecipeCard';

/** Cards of the "Per te" feed, each with a "why you see this" caption. */
export async function FeedGrid({ items, categories }: { items: FeedItem[]; categories: CategoryRow[] }) {
  const t = await getTranslations();
  const caption = (r: FeedReason): string => {
    switch (r.kind) {
      case 'friend':
        return t('feed.reasonFriend');
      case 'tags':
        return t('feed.reasonTags', { tags: (r.tags ?? []).join(', ') });
      case 'category': {
        const c = categories.find((x) => x.id === r.categoryId);
        return c ? t('feed.reasonCategory', { category: categoryLabel(c, t) }) : t('feed.reasonNew');
      }
      case 'popular':
        return t('feed.reasonPopular');
      default:
        return t('feed.reasonNew');
    }
  };
  return (
    <RecipeGrid>
      {items.map((r) => (
        <div key={r.id} className="flex flex-col gap-2">
          <RecipeCard recipe={r} categories={categories} showAuthor />
          <p className="px-1 text-sm text-muted">
            <span className="font-semibold">{t('feed.why')}</span> {caption(r.reason)}
          </p>
        </div>
      ))}
    </RecipeGrid>
  );
}
