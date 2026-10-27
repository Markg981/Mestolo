import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { runCleanupTasks, type CleanupTask } from '@/lib/cron/cleanup-runner';
import { cronSecret } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;
// Margine ampio rispetto a maxDuration: l'ultimo blocco avviato puo' durare qualche secondo.
const BUDGET_MS = 40_000;
/** Retention: expired/revoked invites and sent meal reminders are deleted after this many days. */
const INVITE_GRACE_DAYS = 30;
const REMINDER_RETENTION_DAYS = 30;

function authorized(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Vercel Cron (vercel.json): rimuove dallo Storage i file orfani di recipe-images e avatars
 * e pulisce i dati di quota vecchi. Vercel invia `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  let usage: unknown = null;
  let stale: unknown = null;
  const orphanTask = (bucket: string, rpcName: string): CleanupTask => ({
    name: `orphans:${bucket}`,
    runBatch: async (limit) => {
      const { data: orphans, error: listError } = await admin.rpc(rpcName, { p_limit: limit });
      if (listError) throw new Error(`list_failed: ${listError.message}`);
      const paths = ((orphans as { name: string }[] | null) ?? []).map((o) => o.name);
      if (paths.length === 0) return 0;
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) throw new Error(`remove_failed: ${removeError.message}`);
      return paths.length;
    },
  });

  const tasks: CleanupTask[] = [
    {
      name: 'old-usage',
      runBatch: async () => {
        const { data, error } = await admin.rpc('cleanup_old_usage', { p_days: 90 });
        if (error) throw new Error(`cleanup_failed: ${error.message}`);
        usage = data;
        return 0; // singola chiamata, non a blocchi
      },
    },
    {
      name: 'stale-rows',
      runBatch: async () => {
        const { data, error } = await admin.rpc('cleanup_stale_rows', {
          p_invite_grace_days: INVITE_GRACE_DAYS,
          p_reminder_days: REMINDER_RETENTION_DAYS,
        });
        if (error) throw new Error(`cleanup_failed: ${error.message}`);
        stale = data;
        return 0; // singola chiamata, non a blocchi
      },
    },
    orphanTask('recipe-images', 'list_orphan_images'),
    orphanTask('avatars', 'list_orphan_avatars'),
  ];

  const results = await runCleanupTasks(tasks, {
    budgetMs: BUDGET_MS,
    onError: (task, error) => {
      console.error(`[cron/cleanup] task ${task} failed`, error);
      Sentry.captureException(error, { tags: { cron: 'cleanup', task } });
    },
  });
  const failed = results.filter((r) => r.error);
  const orphansRemoved = results
    .filter((r) => r.name.startsWith('orphans:'))
    .reduce((n, r) => n + r.processed, 0);
  return NextResponse.json(
    { ok: failed.length === 0, usage, stale, orphansRemoved, results },
    { status: failed.length ? 500 : 200 },
  );
}
