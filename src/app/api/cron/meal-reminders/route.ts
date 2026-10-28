import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { cronSecret } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { mealReminderText } from '@/lib/notifications/texts';
import { isAllowedPushEndpoint } from '@/lib/notifications/push-endpoint';
import { parseReminderWindowMinutes } from '@/lib/notifications/reminder-window';
import type { MealSlot } from '@/lib/plan/week';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const USER_CHUNK = 100;
const PAGE_SIZE = 1000;
const SEND_CONCURRENCY = 10;
// Come il cron di cleanup: margine ampio rispetto a maxDuration. Un pasto avviato sotto budget puo' durare fino al timeout
// del push (10 s), poi restano i secondi per confirm_meal_reminders: nessun nuovo invio oltre il budget.
const BUDGET_MS = 40_000;

/** Log strutturato + Sentry come nel cron di cleanup; solo il passo e l'errore del DB, nessun dato di utenti o sottoscrizioni. */
function reportFailure(step: 'claim' | 'subscriptions' | 'confirm', error: unknown) {
  console.error(`[cron/meal-reminders] ${step} failed`, error);
  Sentry.captureException(error, { tags: { cron: 'meal-reminders', step } });
}

function authorized(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Finestra di recupero in minuti (default 45, massimo 60: vedi parseReminderWindowMinutes; i duplicati sono esclusi da meal_reminders_sent). */
function windowMinutes(): number {
  return parseReminderWindowMinutes(process.env.MEAL_REMINDERS_WINDOW_MINUTES);
}

type Due = { entry_id: string; user_id: string; slot: MealSlot; title: string; locale: string };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Cron (vercel.json: giornaliero, compatibile Hobby, e' solo un fallback: alle 08:00 UTC prende i soli pasti con promemoria
 * tra le 07:15 e le 08:00 UTC, cioe' 45 minuti su 24 ore. Lo scheduler reale e' .github/workflows/meal-reminders.yml ogni
 * 15 minuti, oppure vercel.pro.json; con NEXT_PUBLIC_FREQUENT_CRON=true per la UI): invia le notifiche Web Push dei pasti
 * pianificati il cui orario di promemoria, nel fuso dell'utente, e' appena trascorso.
 * Claim e conferma sono separati: il pasto e' confermato (confirm_meal_reminders) solo dopo l'esito del push.
 * Autenticazione: `Authorization: Bearer $CRON_SECRET`. Le sottoscrizioni scadute (404/410) o rifiutate in modo permanente (401/403) vengono eliminate.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return NextResponse.json({ ok: true, skipped: 'vapid_not_configured' });

  const admin = createAdminClient();
  const { data: due, error } = await admin.rpc('claim_due_meal_reminders', { p_window_minutes: windowMinutes() });
  if (error) {
    reportFailure('claim', error);
    return NextResponse.json({ error: 'claim_failed' }, { status: 500 });
  }
  const meals = (due as Due[] | null) ?? [];
  if (meals.length === 0) return NextResponse.json({ ok: true, meals: 0, sent: 0, removed: 0 });

  // Sottoscrizioni lette a blocchi di utenti e a pagine: un limite di righe del server non deve far perdere sottoscrizioni.
  const allSubs: Sub[] = [];
  const userIds = [...new Set(meals.map((m) => m.user_id))];
  for (let i = 0; i < userIds.length; i += USER_CHUNK) {
    const chunk = userIds.slice(i, i + USER_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: subsError } = await admin
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', chunk)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (subsError) {
        reportFailure('subscriptions', subsError);
        return NextResponse.json({ error: 'subscriptions_failed' }, { status: 500 });
      }
      const rows = (data as Sub[] | null) ?? [];
      allSubs.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const byUser = new Map<string, Sub[]>();
  for (const s of allSubs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  // Pasti da confermare: almeno un push riuscito, oppure nessun errore transitorio (niente da ritentare).
  // Se i tentativi falliscono in modo transitorio senza alcun successo il pasto resta non confermato: dopo il
  // lease (5 min) il claim lo riseleziona, finche' e' nella finestra e fino a 3 tentativi.
  const confirm: string[] = [];
  const gone = new Set<string>();
  const processMeal = async (meal: Due) => {
    const text = await mealReminderText(meal.locale, meal.slot, meal.title);
    const payload = JSON.stringify({ title: text.title, body: text.body, url: '/plan', tag: `meal-${meal.entry_id}` });
    let delivered = false;
    let transient = false;
    for (const s of byUser.get(meal.user_id) ?? []) {
      if (gone.has(s.id)) continue;
      if (!isAllowedPushEndpoint(s.endpoint)) {
        gone.add(s.id);
        continue;
      }
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'normal', timeout: 10_000 });
        sent++;
        delivered = true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: sottoscrizione scaduta. 401/403: chiavi VAPID non piu' valide per quella sottoscrizione (es. chiave ruotata):
        // errori permanenti, i tentativi successivi non possono riuscire, quindi la sottoscrizione viene rimossa.
        if (status === 404 || status === 410 || status === 401 || status === 403) {
          gone.add(s.id);
          if (status === 401 || status === 403) console.warn(`[mestolo] meal-reminders: subscription removed (push rejected with ${status})`);
        } else if (status === 400) {
          // Richiesta rifiutata: ritentare non serve, quindi non blocca la conferma del pasto. Non si elimina la
          // sottoscrizione al primo 400 (potrebbe essere un payload/header momentaneamente errato); e' loggato per il monitoraggio.
          console.warn('[mestolo] meal-reminders: push rejected (400), not retried');
        } else {
          transient = true;
          console.error(`[mestolo] meal-reminders: push failed (${status ?? 'network'})`);
        }
      }
    }
    // Confermato solo se almeno un push e' riuscito o l'utente ha davvero zero sottoscrizioni (letture complete).
    if (delivered || !transient) confirm.push(meal.entry_id);
  };
  // Invii con concorrenza limitata (la route ha un tetto di durata, maxDuration).
  const deadline = Date.now() + BUDGET_MS;
  const queue = [...meals];
  await Promise.all(
    Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, async () => {
      for (let meal = queue.shift(); meal; meal = Date.now() < deadline ? queue.shift() : undefined) await processMeal(meal);
    }),
  );
  if (confirm.length > 0) {
    const { error: confirmError } = await admin.rpc('confirm_meal_reminders', { p_entry_ids: confirm });
    if (confirmError) reportFailure('confirm', confirmError);
  }
  // I pasti rinviati restano senza conferma: dopo il lease (5 min) il claim li riseleziona nell'esecuzione successiva.
  const deferred = queue.length;
  if (gone.size > 0) await admin.from('push_subscriptions').delete().in('id', [...gone]);
  return NextResponse.json({ ok: true, meals: meals.length, sent, confirmed: confirm.length, processed: meals.length - deferred, deferred, removed: gone.size });
}
