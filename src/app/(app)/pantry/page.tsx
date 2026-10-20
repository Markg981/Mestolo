import { getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { sortByExpiry, suggestRecipes, type PantryItem } from '@/lib/pantry/match';
import { PantryView } from './PantryView';

export async function generateMetadata() {
  const t = await getTranslations('pantry');
  return { title: t('title') };
}

export default async function PantryPage() {
  const [t, user] = await Promise.all([getTranslations('pantry'), getUser()]);
  const supabase = await createClient();
  const [{ data: rows }, { data: recipes }] = await Promise.all([
    supabase.from('pantry_items').select('id, name, quantity, unit, expires_on, location, note').eq('owner_id', user!.id),
    // RLS decides which recipes are visible (own + accessible ones)
    supabase.from('recipes').select('id, title, ingredients').order('created_at', { ascending: false }).limit(500),
  ]);
  const items = sortByExpiry(((rows as PantryItem[]) ?? []).map((i) => ({ ...i, quantity: i.quantity === null ? null : Number(i.quantity) })));
  const today = new Date().toISOString().slice(0, 10);
  const suggestions = suggestRecipes(
    ((recipes as { id: string; title: string; ingredients: { name: string; toTaste?: boolean }[] | null }[]) ?? []).map((r) => ({ ...r, ingredients: r.ingredients ?? [] })),
    items,
    today,
  ).slice(0, 12);
  return (
    <div>
      <PageHeader title={t('title')} lead={t('lead')} />
      <PantryView items={items} suggestions={suggestions} today={today} />
    </div>
  );
}
