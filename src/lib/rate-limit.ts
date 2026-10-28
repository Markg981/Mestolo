import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { extractClientIp, UNKNOWN_IP } from '@/lib/client-ip';
import { createAdminClient } from '@/lib/supabase/admin';

/** Limits per action: [max events, window in seconds]. */
export const LIMITS = {
  login_ip: [20, 15 * 60],
  // Tentativi (non solo fallimenti) per email, contati PRIMA di interrogare Supabase.
  login_email: [30, 15 * 60],
  login_email_ip: [8, 15 * 60],
  password_verify: [10, 15 * 60],
  signup_ip: [6, 60 * 60],
  reset_ip: [5, 60 * 60],
  reset_email: [3, 60 * 60],
  password_update: [10, 60 * 60],
  import_url: [30, 60 * 60],
  import_photo: [12, 60 * 60],
  import_video_ai: [6, 60 * 60],
  ai_text: [40, 60 * 60],
  ai_translate: [60, 60 * 60],
  ai_image: [6, 60 * 60],
  friend_request: [30, 24 * 60 * 60],
  report: [20, 24 * 60 * 60],
  api_key_change: [10, 60 * 60],
  upload_image: [60, 60 * 60],
  upload_image_day: [150, 24 * 60 * 60],
  account_delete: [5, 60 * 60],
  export_data: [10, 60 * 60],
  invite_create: [10, 60 * 60],
  invite_accept: [20, 60 * 60],
  user_search: [60, 15 * 60],
  push_subscribe: [20, 60 * 60],
  feedback_send: [10, 24 * 60 * 60],
  // Creazione ricette (anche copie). Larghi: un import in blocco reale resta sotto, un ciclo di abuso no.
  recipe_create: [300, 60 * 60],
  recipe_create_day: [600, 24 * 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;

export type LimitName = keyof typeof LIMITS;

export class RateLimitedError extends Error {
  constructor(public limit: LimitName) {
    super('rate_limited');
  }
}

export function hashKey(value: string): string {
  return createHash('sha256').update(`mestolo:${value}`).digest('hex').slice(0, 32);
}

export async function clientIpHash(): Promise<string> {
  const h = await headers();
  return hashKey(extractClientIp(h));
}

/** Records an event and throws RateLimitedError if the limit is exceeded. Fails closed. */
export async function enforceRateLimit(limit: LimitName, subject: string): Promise<void> {
  const [max, windowSec] = LIMITS[limit];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_bucket: `${limit}:${subject}`,
    p_max: max,
    p_window_seconds: windowSec,
  });
  if (error) throw new Error('rate_limit_unavailable');
  if (data !== true) throw new RateLimitedError(limit);
}

/**
 * Rate limit for unauthenticated auth flows. Only our own RateLimitedError is
 * surfaced as such; if the limiter itself errors we log it and fail closed
 * (the error is rethrown), so an outage cannot be used to bypass throttling.
 */
export async function enforceAuthRateLimit(limit: LimitName, subject: string): Promise<void> {
  try {
    await enforceRateLimit(limit, subject);
  } catch (e) {
    if (!(e instanceof RateLimitedError)) console.error(`[mestolo] auth rate limiter unavailable (${limit}):`, e);
    throw e;
  }
}

/** Come clientIpHash ma null se l'IP e sconosciuto: evita il bucket condiviso (DoS globale). */
export async function clientIpHashOrNull(): Promise<string | null> {
  const ip = extractClientIp(await headers());
  return ip === UNKNOWN_IP ? null : hashKey(ip);
}
