import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { mealReminderText } from '@/lib/notifications/texts';
import type { MealSlot } from '@/lib/plan/week';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Due = { entry_id: string; user_id: string; slot: MealSlot; title: string; locale: string };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Cron (vercel.json o scheduler esterno ogni 15 minuti): invia le notifiche Web Push dei pasti
 * pianificati il cui orario di promemoria, nel fuso dell'utente, e' appena trascorso.
 * Autenticazione: `Authorization: Bearer $CRON_SECRET`. Le sottoscrizioni scadute (404/410) vengono eliminate.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return NextResponse.json({ ok: true, skipped: 'vapid_not_configured' });

  const admin = createAdminClient();
  const { data: due, error } = await admin.rpc('claim_due_meal_reminders', { p_window_minutes: 20 });
  if (error) return NextResponse.json({ error: 'claim_failed' }, { status: 500 });
  const meals = (due as Due[] | null) ?? [];
  if (meals.length === 0) return NextResponse.json({ ok: true, meals: 0, sent: 0, removed: 0 });

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', [...new Set(meals.map((m) => m.user_id))]);
  if (subsError) return NextResponse.json({ error: 'subscriptions_failed' }, { status: 500 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const byUser = new Map<string, Sub[]>();
  for (const s of (subs as Sub[] | null) ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  const gone = new Set<string>();
  for (const meal of meals) {
    const text = await mealReminderText(meal.locale, meal.slot, meal.title);
    const payload = JSON.stringify({ title: text.title, body: text.body, url: '/plan', tag: `meal-${meal.entry_id}` });
    for (const s of byUser.get(meal.user_id) ?? []) {
      if (gone.has(s.id)) continue;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'normal' });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.add(s.id);
        else console.error(`[mestolo] meal-reminders: push failed (${status ?? 'network'})`);
      }
    }
  }
  if (gone.size > 0) await admin.from('push_subscriptions').delete().in('id', [...gone]);
  return NextResponse.json({ ok: true, meals: meals.length, sent, removed: gone.size });
}
