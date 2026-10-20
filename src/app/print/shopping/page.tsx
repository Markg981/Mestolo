import { getLocale, getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { PrintButton } from '../PrintButton';

export default async function PrintShoppingPage() {
  const [t, locale, user] = await Promise.all([getTranslations(), getLocale(), getUser()]);
  const supabase = await createClient();
  const { data } = await supabase.from('shopping_items').select('name, quantity, unit, note').eq('owner_id', user!.id).eq('checked', false).order('created_at');
  const items = (data as { name: string; quantity: number | null; unit: string | null; note: string | null }[]) ?? [];
  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? t(`units.${u}`) : u);
  return (
    <article className="flex flex-col gap-4">
      <PrintButton />
      <h1 className="text-3xl font-extrabold">{t('shopping.title')}</h1>
      <ul className="flex flex-col gap-2">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-start gap-3 border-b pb-2">
            <span aria-hidden className="mt-1 inline-block size-4 border border-black" />
            <span>
              {i.quantity !== null && <strong>{formatQuantity(Number(i.quantity), locale)} {unit(i.unit)} </strong>}
              {i.name}
              {i.note ? `, ${i.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
