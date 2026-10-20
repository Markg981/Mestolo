import 'server-only';
import { getTranslations } from 'next-intl/server';
import { listCategories } from './recipes';
import { categoryLabel } from '@/lib/recipes/categories';
import type { EditorCategory } from '@/components/recipes/editor/types';

/** Categories with translated labels, for the editor (uncategorized is the empty option). */
export async function editorCategories(): Promise<EditorCategory[]> {
  const [cats, t] = await Promise.all([listCategories(), getTranslations()]);
  return cats
    .filter((c) => !(c.owner_id === null && c.slug === 'uncategorized'))
    .map((c) => ({ id: c.id, slug: c.slug, label: categoryLabel(c, t), system: c.owner_id === null }));
}

export async function unitLabeler() {
  const tu = await getTranslations('units');
  return (key: string) => (tu.has(key) ? tu(key) : key);
}
