import { getLocale, getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { groupByAisle } from '@/lib/shopping/aisles';
import { loadAisleOverrides, loadItems, resolveShoppingList } from '@/lib/shopping/data';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { PrintButton } from '../PrintButton';

export default async function PrintShoppingPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const [t, locale, user, sp] = await Promise.all([getTranslations(), getLocale(), getUser(), searchParams]);
  const resolved = await resolveShoppingList(user!.id, sp.list);
  const rows = resolved ? (await loadItems(resolved.selected.id)).filter((i) => !i.checked) : [];
  const overrides = resolved ? await loadAisleOverrides(resolved.selected.id) : {};
  const groups = groupByAisle(rows, overrides);
  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? t(`units.${u}`) : u);
  return (
    <article className="flex flex-col gap-4">
      <PrintButton />
      <h1 className="text-3xl font-extrabold">{t('shopping.title')}</h1>
      {groups.map((g) => (
        <section key={g.aisle} className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t(`shopping.aisles.${g.aisle}`)}</h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 border-b pb-2">
                <span aria-hidden className="mt-1 inline-block size-4 border border-black" />
                <span>
                  {i.quantity !== null && <strong>{formatQuantity(Number(i.quantity), locale)} {unit(i.unit)} </strong>}
                  {i.name}
                  {i.note ? `, ${i.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
