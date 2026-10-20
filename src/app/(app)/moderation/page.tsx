import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { ModerationActions } from './ModerationActions';

type Report = { id: string; recipe_id: string; reporter_id: string; reason: string; details: string; status: string; created_at: string };

export async function generateMetadata() {
  const t = await getTranslations('moderation');
  return { title: t('title') };
}

/** Visible only to moderators (role assigned by the operator via SQL). Data access is also enforced by RLS. */
export default async function ModerationPage() {
  const profile = await getProfile();
  if (!profile?.is_moderator) notFound();
  const [t, tr, format] = await Promise.all([getTranslations('moderation'), getTranslations('report'), getFormatter()]);
  const supabase = await createClient();
  const { data } = await supabase.from('reports').select('id, recipe_id, reporter_id, reason, details, status, created_at').order('created_at', { ascending: false }).limit(300);
  const reports = (data as Report[]) ?? [];
  const recipeIds = [...new Set(reports.map((r) => r.recipe_id))];
  const userIds = [...new Set(reports.map((r) => r.reporter_id))];
  const [{ data: recipes }, { data: users }] = await Promise.all([
    recipeIds.length ? supabase.from('recipes').select('id, title, owner_id, is_hidden, visibility').in('id', recipeIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from('profiles').select('id, username').in('id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const recipeById = new Map(((recipes as { id: string; title: string; owner_id: string; is_hidden: boolean; visibility: string }[]) ?? []).map((r) => [r.id, r]));
  const userById = new Map(((users as { id: string; username: string }[]) ?? []).map((u) => [u.id, u.username]));
  const open = reports.filter((r) => r.status === 'open');
  const openCount = (rid: string) => open.filter((r) => r.recipe_id === rid).length;
  const hidden = [...recipeById.values()].filter((r) => r.is_hidden);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={t('title')} lead={t('lead')} />
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">{t('openTitle', { n: open.length })}</h2>
        {open.length ? (
          <ul className="flex flex-col gap-3">
            {open.map((r) => {
              const recipe = recipeById.get(r.recipe_id);
              return (
                <li key={r.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="tomato">{tr(`reasons.${r.reason}` as 'reasons.spam')}</Badge>
                    {recipe?.is_hidden && <Badge tone="ink">{t('hiddenBadge')}</Badge>}
                    <Badge>{t('reportsCount', { n: openCount(r.recipe_id) })}</Badge>
                  </div>
                  {recipe ? (
                    <Link href={`/recipes/${recipe.id}`} className="font-display text-lg font-bold text-basil underline underline-offset-4">
                      {recipe.title}
                    </Link>
                  ) : (
                    <span className="text-muted">{t('recipeGone')}</span>
                  )}
                  {r.details && <p className="whitespace-pre-line">{r.details}</p>}
                  <p className="text-sm text-muted">
                    {t('reportedBy', { name: `@${userById.get(r.reporter_id) ?? '?'}` })}, {format.dateTime(new Date(r.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  <ModerationActions reportId={r.id} hidden={!!recipe?.is_hidden} />
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t('emptyTitle')}>{t('empty')}</EmptyState>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">{t('hiddenTitle')}</h2>
        {hidden.length ? (
          <ul className="flex flex-col gap-2">
            {hidden.map((r) => {
              const last = reports.find((x) => x.recipe_id === r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                  <Link href={`/recipes/${r.id}`} className="min-w-0 flex-1 font-semibold underline underline-offset-4">
                    {r.title}
                  </Link>
                  {last && <ModerationActions reportId={last.id} hidden onlyRestore />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">{t('hiddenEmpty')}</p>
        )}
      </section>
    </div>
  );
}
