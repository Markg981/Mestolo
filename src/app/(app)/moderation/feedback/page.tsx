import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { FeedbackStatusActions } from './FeedbackStatusActions';

type Row = { id: string; user_id: string; kind: 'bug' | 'idea' | 'other'; message: string; page_path: string | null; platform: 'web' | 'android' | 'ios'; app_version: string | null; status: 'new' | 'seen' | 'done'; created_at: string };
const STATUSES = ['new', 'seen', 'done'] as const;

export async function generateMetadata() {
  const t = await getTranslations('feedback');
  return { title: t('adminTitle') };
}

/** Visible only to moderators; RLS gives them access to every row. */
export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const profile = await getProfile();
  if (!profile?.is_moderator) notFound();
  const { status } = await searchParams;
  const filter = STATUSES.find((s) => s === status);
  const [t, format] = await Promise.all([getTranslations('feedback'), getFormatter()]);
  const supabase = await createClient();
  let q = supabase.from('app_feedback').select('id, user_id, kind, message, page_path, platform, app_version, status, created_at').order('created_at', { ascending: false }).limit(200);
  if (filter) q = q.eq('status', filter);
  const { data } = await q;
  const rows = (data as Row[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: users } = ids.length ? await supabase.from('profiles').select('id, username').in('id', ids) : { data: [] };
  const nameById = new Map(((users as { id: string; username: string }[]) ?? []).map((u) => [u.id, u.username]));
  const tab = (href: string, active: boolean, label: string) => (
    <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`rounded-full border px-4 py-2 font-semibold ${active ? 'border-basil bg-basil text-white' : 'border-line bg-surface hover:bg-sunk'}`}>
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('adminTitle')}
        lead={t('adminLead')}
        back={
          <Link href="/moderation" className="inline-flex min-h-11 items-center self-start text-basil underline underline-offset-4">
            {t('backToModeration')}
          </Link>
        }
      />
      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {tab('/moderation/feedback', !filter, t('filterAll'))}
        {STATUSES.map((s) => tab(`/moderation/feedback?status=${s}`, filter === s, t(`statuses.${s}`)))}
      </nav>
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.kind === 'bug' ? 'tomato' : r.kind === 'idea' ? 'saffron' : 'neutral'}>{t(`kinds.${r.kind}`)}</Badge>
                <Badge tone={r.status === 'new' ? 'ink' : r.status === 'done' ? 'basil' : 'neutral'}>{t(`statuses.${r.status}`)}</Badge>
                <Badge>{`${t(`platforms.${r.platform}`)}${r.app_version ? ` ${r.app_version}` : ''}`}</Badge>
              </div>
              <p className="whitespace-pre-line">{r.message}</p>
              <p className="text-sm text-muted">
                @{nameById.get(r.user_id) ?? '?'}, {format.dateTime(new Date(r.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
                {r.page_path ? ` - ${r.page_path}` : ''}
              </p>
              <FeedbackStatusActions id={r.id} status={r.status} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t('adminEmptyTitle')}>{t('adminEmpty')}</EmptyState>
      )}
    </div>
  );
}
