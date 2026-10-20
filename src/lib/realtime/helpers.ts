// Pure helpers for the Realtime refresh hook (kept free of React and Supabase
// so they can be unit-tested).

/** Tables synced across devices, with the column that holds the owner. */
export const REALTIME_TABLES = [
  { table: 'shopping_items', column: 'owner_id' },
  { table: 'meal_plan_entries', column: 'owner_id' },
  { table: 'recipes', column: 'owner_id' },
  { table: 'favorites', column: 'user_id' },
] as const;

/** postgres_changes filter limiting events to the signed-in user's rows. */
export function userFilter(column: string, userId: string): string {
  return `${column}=eq.${userId}`;
}

export interface Debounced {
  (): void;
  cancel(): void;
}

/** Coalesces bursts of events into a single trailing call. */
export function debounce(fn: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, waitMs);
  }) as Debounced;
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return run;
}

/** Whether a refresh may run now: tab visible and network up. */
export function canRefreshNow(visible: boolean, online: boolean): boolean {
  return visible && online;
}
