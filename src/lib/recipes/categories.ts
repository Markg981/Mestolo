/** System category slugs, in display order. Labels live in the i18n messages (categories.<slug>). */
export const SYSTEM_CATEGORY_SLUGS = [
  'starters',
  'first-courses',
  'main-courses',
  'sides',
  'desserts',
  'bread-baking',
  'drinks',
  'breakfast',
  'snacks',
  'sauces',
  'uncategorized',
] as const;
export type SystemCategorySlug = (typeof SYSTEM_CATEGORY_SLUGS)[number];
export const UNCATEGORIZED: SystemCategorySlug = 'uncategorized';

export interface CategoryRow {
  id: string;
  slug: string;
  owner_id: string | null;
  name: string | null;
  sort_order: number;
}

/** Display name of a category: system ones are translated, custom ones use their name. */
export function categoryLabel(cat: Pick<CategoryRow, 'slug' | 'owner_id' | 'name'> | null | undefined, t: (key: string) => string): string {
  if (!cat) return t('categories.uncategorized');
  if (cat.owner_id === null && (SYSTEM_CATEGORY_SLUGS as readonly string[]).includes(cat.slug)) {
    return t(`categories.${cat.slug}`);
  }
  return cat.name ?? cat.slug;
}
