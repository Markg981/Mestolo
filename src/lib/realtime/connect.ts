// Realtime subscription with status handling and backoff resubscription.
// Kept free of React so it can be unit-tested with a mocked Supabase client.

export interface RealtimeChannelLike {
  on(type: 'postgres_changes', filter: Record<string, unknown>, cb: () => void): RealtimeChannelLike;
  subscribe(cb?: (status: string) => void): unknown;
}

export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
}

export interface TableSpec {
  table: string;
  filter?: string;
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

/**
 * Opens one channel for all tables. On CHANNEL_ERROR / TIMED_OUT / CLOSED the
 * channel is removed and re-created after an exponential backoff; every
 * successful reconnect calls onReconnect (to catch events missed meanwhile).
 * Returns a disposer that clears timers and removes the channel.
 */
export function connectRealtime(
  supabase: RealtimeClientLike,
  name: string,
  tables: readonly TableSpec[],
  onChange: () => void,
  onReconnect: () => void,
): () => void {
  let channel: RealtimeChannelLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let disposed = false;
  let everSubscribed = false;

  const open = () => {
    if (disposed) return;
    const ch = supabase.channel(name);
    channel = ch;
    for (const { table, filter } of tables) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, onChange);
    }
    ch.subscribe((status) => {
      if (disposed || channel !== ch) return;
      if (status === 'SUBSCRIBED') {
        attempt = 0;
        if (everSubscribed) onReconnect();
        everSubscribed = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void supabase.removeChannel(ch);
        channel = undefined;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          open();
        }, backoffDelay(attempt++));
      }
    });
  };
  open();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (channel) void supabase.removeChannel(channel);
    channel = undefined;
  };
}
