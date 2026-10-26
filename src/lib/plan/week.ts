/** ISO date helpers for the weekly meal plan (weeks start on Monday, dates in YYYY-MM-DD, UTC arithmetic). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Default zone for "today"/week on the server (Vercel runs in UTC). */
export const APP_TIME_ZONE = 'Europe/Rome';

/** Calendar day (YYYY-MM-DD) of `now` in `timeZone`; pass null to use the runtime's local zone (client). */
export function todayIso(now: Date = new Date(), timeZone: string | null = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Monday (YYYY-MM-DD) of the week containing `now` in `timeZone`. */
export function currentWeekStart(now: Date = new Date(), timeZone: string | null = APP_TIME_ZONE): string {
  return startOfWeek(parseIsoDate(todayIso(now, timeZone)));
}

export function startOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return toIsoDate(d);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function weekDays(weekStart: string): string[] {
  const start = startOfWeek(parseIsoDate(weekStart));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
