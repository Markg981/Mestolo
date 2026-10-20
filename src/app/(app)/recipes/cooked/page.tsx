import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { listMyCookLogs } from '@/lib/data/cook-logs';
import { CookLogCard } from '@/components/cooking/CookLogs';
import { EmptyState, LadleMark, LinkButton, PageHeader } from '@/components/ui';

export async function generateMetadata() {
  const t = await getTranslations('cookLog');
  return { title: t('historyTitle') };
}

/** The user's own cook history: every "I cooked it" entry, private ones included. */
export default async function CookedHistoryPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  const [t, locale, logs] = await Promise.all([getTranslations('cookLog'), getLocale(), listMyCookLogs(user.id)]);
  return (
    <div>
      <PageHeader title={t('historyTitle')} lead={t('historyLead')} />
      {logs.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {logs.map((l) => (
            <CookLogCard key={l.id} log={l} locale={locale} mine isRecipeOwner={false} title={{ id: l.recipe_id, text: l.recipeTitle ?? t('unavailableRecipe') }} />
          ))}
        </ul>
      ) : (
        <EmptyState
          illustration={<LadleMark />}
          title={t('historyEmptyTitle')}
          action={
            <LinkButton href="/recipes" variant="primary">
              {t('historyBrowse')}
            </LinkButton>
          }
        >
          {t('historyEmpty')}
        </EmptyState>
      )}
    </div>
  );
}
