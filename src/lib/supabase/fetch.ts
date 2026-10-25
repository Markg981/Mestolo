/** Default cap for a single Supabase HTTP request (a paused free-tier project never answers). */
export const DEFAULT_SUPABASE_TIMEOUT_MS = 12_000;

function timeoutMs(): number {
  const n = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUPABASE_TIMEOUT_MS;
}

function combine(signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any(signals), cleanup: () => {} };
  const controller = new AbortController();
  const listeners = signals.map((s) => {
    const onAbort = () => controller.abort(s.reason);
    if (s.aborted) onAbort();
    else s.addEventListener('abort', onAbort, { once: true });
    return () => s.removeEventListener('abort', onAbort);
  });
  return { signal: controller.signal, cleanup: () => listeners.forEach((off) => off()) };
}

/**
 * Wraps fetch with a timeout, merged with any caller-provided signal. On timeout the
 * request rejects with a TimeoutError, which supabase-js turns into the usual `error`.
 * HTTP only: realtime websockets do not go through this.
 */
export function createTimeoutFetch(ms: number = timeoutMs(), baseFetch: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const signals = [AbortSignal.timeout(ms)];
    const own = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (own) signals.push(own);
    const { signal, cleanup } = combine(signals);
    try {
      return await baseFetch(input, { ...init, signal });
    } finally {
      cleanup();
    }
  };
}
