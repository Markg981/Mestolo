import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { listRecipeCookLogs, type CookLogItem } from '@/lib/data/cook-logs';
import { formatDateUtc } from '@/lib/format-date';
import { CookedItButton, CookLogControls } from './CookedIt';

export function formatCookDate(iso: string, locale: string) {
  return formatDateUtc(iso, locale);
}

/** Detail-page section: "cooked N times" counter, the "I cooked it" button and the gallery of visible logs. */
export async function CookLogsSection({ recipeId, userId, recipeOwnerId }: { recipeId: string; userId: string; recipeOwnerId: string }) {
  const [t, locale, { count, logs }] = await Promise.all([getTranslations('cookLog'), getLocale(), listRecipeCookLogs(recipeId)]);
  return (
    <section aria-labelledby="cooklog-title" className="mt-6 flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="cooklog-title" className="text-xl font-bold">
            {t('title')}
          </h2>
          <p className="text-muted">{t('count', { count })}</p>
        </div>
        <CookedItButton recipeId={recipeId} />
      </div>
      {logs.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {logs.map((l) => (
            <CookLogCard key={l.id} log={l} locale={locale} mine={l.user_id === userId} isRecipeOwner={recipeOwnerId === userId} />
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href="/recipes/cooked" className="text-terracotta-deep underline underline-offset-4">
          {t('myHistory')}
        </Link>
      </p>
    </section>
  );
}

export async function CookLogCard({ log, locale, mine, isRecipeOwner, title }: { log: CookLogItem; locale: string; mine: boolean; isRecipeOwner: boolean; title?: { id: string; text: string } }) {
  const t = await getTranslations('cookLog');
  const who = mine ? t('you') : log.displayName || log.username;
  return (
    <li className="flex flex-col gap-2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {log.has_photo && <img src={`/api/cook-photos/${log.id}`} alt={t('photoAlt', { date: formatCookDate(log.cooked_at, locale) })} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />}
      <div className="flex flex-col gap-1 p-4">
        {title && (
          <Link href={`/recipes/${title.id}`} className="inline-flex min-h-11 items-center self-start font-semibold text-terracotta-deep underline underline-offset-4">
            {title.text}
          </Link>
        )}
        <p className="text-sm text-muted">
          <time dateTime={log.cooked_at}>{formatCookDate(log.cooked_at, locale)}</time>
          {who ? ` · ${who}` : ''}
          {log.visibility === 'private' && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Lock aria-hidden className="size-3.5" />
              {t('privateBadge')}
            </span>
          )}
        </p>
        {log.note && <p className="whitespace-pre-line">{log.note}</p>}
        {(mine || isRecipeOwner) && <CookLogControls logId={log.id} canToggle={mine} visibility={log.visibility} />}
      </div>
    </li>
  );
}
