import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const BATCH = 200;
/** Retention: expired/revoked invites and sent meal reminders are deleted after this many days. */
const INVITE_GRACE_DAYS = 30;
const REMINDER_RETENTION_DAYS = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
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
  const { data: usage, error: usageError } = await admin.rpc('cleanup_old_usage', { p_days: 90 });
  if (usageError) return NextResponse.json({ error: 'cleanup_failed' }, { status: 500 });

  const { data: stale, error: staleError } = await admin.rpc('cleanup_stale_rows', {
    p_invite_grace_days: INVITE_GRACE_DAYS,
    p_reminder_days: REMINDER_RETENTION_DAYS,
  });
  if (staleError) return NextResponse.json({ error: 'cleanup_failed', usage }, { status: 500 });

  let removed = 0;
  for (const { bucket, rpcName } of [
    { bucket: 'recipe-images', rpcName: 'list_orphan_images' },
    { bucket: 'avatars', rpcName: 'list_orphan_avatars' },
  ]) {
    const { data: orphans, error: listError } = await admin.rpc(rpcName, { p_limit: BATCH });
    if (listError) return NextResponse.json({ error: 'list_failed', usage }, { status: 500 });
    const paths = ((orphans as { name: string }[] | null) ?? []).map((o) => o.name);
    if (paths.length === 0) continue;
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) return NextResponse.json({ error: 'remove_failed', usage }, { status: 500 });
    removed += paths.length;
  }
  return NextResponse.json({ ok: true, usage, stale, orphansRemoved: removed });
}
