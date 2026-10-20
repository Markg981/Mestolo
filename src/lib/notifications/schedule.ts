import { MEAL_SLOTS, type MealSlot } from '@/lib/plan/week';

/** Pure scheduling logic for meal reminders (no I/O): used by the native local notifications and tested in isolation. */

export type SlotTimes = Record<MealSlot, string | null>;

export type ReminderPrefs = {
  enabled: boolean;
  timezone: string;
  times: SlotTimes;
};

export type PlannedMeal = { id: string; plan_date: string; slot: MealSlot; title: string };

export type ScheduledReminder = { id: number; at: Date; slot: MealSlot; title: string };

export const DEFAULT_TIMES: SlotTimes = { breakfast: null, lunch: '11:30', dinner: '18:30', snack: null };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.length > 0 && tz.length <= 64;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the wall clock of `tz` shows `isoDate` `hhmm`. In a DST gap the instant just after the jump is returned. */
export function zonedInstant(isoDate: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - tzOffsetMs(wall, tz);
  guess = wall - tzOffsetMs(guess, tz);
  return new Date(guess);
}

/** Stable positive 31-bit id from the entry uuid (Android notification ids are 32-bit ints). */
export function notificationId(entryId: string): number {
  let h = 2166136261;
  for (let i = 0; i < entryId.length; i++) {
    h ^= entryId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) & 0x7fffffff || 1;
}

/** Reminders to schedule: future ones within `days` days from `now`, for slots that have a reminder time. */
export function planReminders(entries: PlannedMeal[], prefs: ReminderPrefs, now: Date, days = 7): ScheduledReminder[] {
  if (!prefs.enabled) return [];
  const horizon = now.getTime() + days * 86_400_000;
  const out: ScheduledReminder[] = [];
  for (const e of entries) {
    const time = prefs.times[e.slot];
    if (!time || !TIME_RE.test(time) || !/^\d{4}-\d{2}-\d{2}$/.test(e.plan_date)) continue;
    const at = zonedInstant(e.plan_date, time, prefs.timezone);
    if (at.getTime() <= now.getTime() || at.getTime() > horizon) continue;
    out.push({ id: notificationId(e.id), at, slot: e.slot, title: e.title });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type PrefsRow = { enabled: boolean; timezone: string; breakfast_time: string | null; lunch_time: string | null; dinner_time: string | null; snack_time: string | null };
export const PREFS_COLUMNS = 'enabled, timezone, breakfast_time, lunch_time, dinner_time, snack_time';
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** Database row (time columns come back as HH:MM:SS) to the preferences used by the UI and the scheduler. */
export function rowToPrefs(r: PrefsRow | null): ReminderPrefs {
  if (!r) return { enabled: false, timezone: 'Europe/Rome', times: { ...DEFAULT_TIMES } };
  return {
    enabled: r.enabled,
    timezone: r.timezone,
    times: { breakfast: hhmm(r.breakfast_time), lunch: hhmm(r.lunch_time), dinner: hhmm(r.dinner_time), snack: hhmm(r.snack_time) },
  };
}

export function isMealSlot(v: unknown): v is MealSlot {
  return typeof v === 'string' && (MEAL_SLOTS as readonly string[]).includes(v);
}
