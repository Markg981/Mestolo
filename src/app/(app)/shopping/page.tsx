import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { ShoppingList, type Item } from './ShoppingList';

export async function generateMetadata() {
  const t = await getTranslations('shopping');
  return { title: t('title') };
}

export default async function ShoppingPage() {
  const [t, user] = await Promise.all([getTranslations('shopping'), getUser()]);
  const supabase = await createClient();
  const { data } = await supabase
    .from('shopping_items')
    .select('id, name, quantity, unit, note, checked, recipe_id, recipe_title, created_at')
    .eq('owner_id', user!.id)
    .order('checked')
    .order('created_at');
  const items = ((data as Item[]) ?? []).map((i) => ({ ...i, quantity: i.quantity === null ? null : Number(i.quantity) }));
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <ShoppingList items={items} />
    </div>
  );
}
