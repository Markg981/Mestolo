'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { addDays, todayIso } from '@/lib/plan/week';
import { PREFS_COLUMNS, TIME_RE, isMealSlot, isValidTimeZone, rowToPrefs, type PlannedMeal, type PrefsRow, type ReminderPrefs } from '@/lib/notifications/schedule';
import { isAllowedPushEndpoint } from '@/lib/notifications/push-endpoint';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const time = z.string().regex(TIME_RE).nullable();
const prefsSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().refine(isValidTimeZone),
  times: z.object({ breakfast: time, lunch: time, dinner: time, snack: time }),
});

export async function saveNotificationPreferences(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = prefsSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: user.id,
    enabled: p.data.enabled,
    timezone: p.data.timezone,
    breakfast_time: p.data.times.breakfast,
    lunch_time: p.data.times.lunch,
    dinner_time: p.data.times.dinner,
    snack_time: p.data.times.snack,
  });
  if (error) return dbFailure(error, 'saveNotificationPreferences');
  return ok();
}

const subscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine(isAllowedPushEndpoint),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = subscriptionSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null;
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: p.data.endpoint,
    p_p256dh: p.data.keys.p256dh,
    p_auth: p.data.keys.auth,
    p_user_agent: userAgent,
  });
  if (error) return dbFailure(error, 'savePushSubscription');
  return ok();
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || typeof endpoint !== 'string' || endpoint.length > 2048) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  if (error) return dbFailure(error, 'removePushSubscription');
  return ok();
}

/** Preferences plus the meals planned from yesterday to 8 days ahead, used by the native app to (re)schedule local notifications. */
export async function getReminderPlan(): Promise<ActionResult<{ prefs: ReminderPrefs; entries: PlannedMeal[] }>> {
  const user = await getUser();
  if (!user) return fail('forbidden');
  const supabase = await createClient();
  const today = todayIso();
  const [{ data: prefs }, { data: entries, error }] = await Promise.all([
    supabase.from('notification_preferences').select(PREFS_COLUMNS).eq('user_id', user.id).maybeSingle(),
    supabase.from('meal_plan_entries').select('id, plan_date, slot, title').eq('owner_id', user.id).gte('plan_date', addDays(today, -1)).lte('plan_date', addDays(today, 8)).order('plan_date'),
  ]);
  if (error) return dbFailure(error, 'getReminderPlan');
  const meals = ((entries as PlannedMeal[] | null) ?? []).filter((e) => isMealSlot(e.slot));
  return ok({ prefs: rowToPrefs(prefs as PrefsRow | null), entries: meals });
}
