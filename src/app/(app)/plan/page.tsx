import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient, getUser } from '@/lib/supabase/server';
import { addDays, MEAL_SLOTS, startOfWeek, weekDays } from '@/lib/plan/week';
import { PageHeader, buttonClass } from '@/components/ui';
import { MealReminderSync } from '@/components/pwa/MealReminderSync';
import { categoryLabel, type CategoryRow } from '@/lib/recipes/categories';
import { prefsFromRow, type PrefsRow } from '@/lib/plan/preferences';
import { PlanBoard, type Entry } from './PlanBoard';
import { PlanGenerator } from './PlanGenerator';

export async function generateMetadata() {
  const t = await getTranslations('plan');
  return { title: t('title') };
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const [t, format, user] = await Promise.all([getTranslations('plan'), getFormatter(), getUser()]);
  const base = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : startOfWeek(new Date());
  const days = weekDays(base);
  const supabase = await createClient();
  const tAll = await getTranslations();
  const [{ data: prefsRow }, { data: cats }, { data: entries }, { data: mine }, { data: favs }] = await Promise.all([
    supabase.from('plan_preferences').select('*').eq('user_id', user!.id).maybeSingle(),
    supabase.from('categories').select('id, slug, owner_id, name, sort_order').order('sort_order'),
    supabase.from('meal_plan_entries').select('id, plan_date, slot, title, recipe_id, servings').eq('owner_id', user!.id).gte('plan_date', days[0]).lte('plan_date', days[6]).order('created_at'),
    supabase.from('recipes').select('id, title').eq('owner_id', user!.id).order('updated_at', { ascending: false }).limit(300),
    supabase.from('favorites').select('recipe_id, recipes(id, title)').eq('user_id', user!.id).limit(100),
  ]);
  const favRecipes = ((favs as unknown as { recipes: { id: string; title: string } | null }[]) ?? []).map((f) => f.recipes).filter(Boolean) as { id: string; title: string }[];
  const options = [...((mine as { id: string; title: string }[]) ?? []), ...favRecipes.filter((f) => !(mine ?? []).some((m: { id: string }) => m.id === f.id))];
  const today = new Date().toISOString().slice(0, 10);
  const dayItems = days.map((d) => ({ iso: d, label: format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: 'long', day: 'numeric', timeZone: 'UTC' }) }));

  return (
    <div>
      <MealReminderSync version={((entries as Entry[]) ?? []).map((e) => `${e.id}${e.plan_date}${e.slot}`).join()} />
      <PageHeader
        title={t('title')}
        lead={t('lead')}
        actions={
          <nav aria-label={t('weekNav')} className="flex flex-wrap gap-2">
            <Link href={`/plan?week=${addDays(days[0], -7)}`} className={buttonClass('secondary', 'sm')}>
              {t('prevWeek')}
            </Link>
            <Link href="/plan" className={buttonClass('ghost', 'sm')}>
              {t('thisWeek')}
            </Link>
            <Link href={`/plan?week=${addDays(days[0], 7)}`} className={buttonClass('secondary', 'sm')}>
              {t('nextWeek')}
            </Link>
          </nav>
        }
      />
      <p className="mb-4 font-semibold">
        {format.dateTime(new Date(`${days[0]}T12:00:00Z`), { day: 'numeric', month: 'long' })} – {format.dateTime(new Date(`${days[6]}T12:00:00Z`), { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <PlanGenerator
        weekStart={days[0]}
        days={dayItems}
        dayNames={days.map((d) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: 'long', timeZone: 'UTC' }))}
        prefs={prefsFromRow(prefsRow as PrefsRow | null)}
        categories={((cats as CategoryRow[]) ?? []).filter((c) => c.slug !== 'uncategorized').map((c) => ({ id: c.id, label: categoryLabel(c, tAll as unknown as (k: string) => string) }))}
        hasEntries={(entries ?? []).length > 0}
      />
      <PlanBoard
        weekStart={days[0]}
        days={dayItems.map((d) => ({ ...d, today: d.iso === today }))}
        slots={[...MEAL_SLOTS]}
        entries={(entries as Entry[]) ?? []}
        recipes={options}
      />
    </div>
  );
}
