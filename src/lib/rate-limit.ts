import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

/** Limits per action: [max events, window in seconds]. */
export const LIMITS = {
  login_ip: [20, 15 * 60],
  login_email: [8, 15 * 60],
  signup_ip: [6, 60 * 60],
  reset_ip: [5, 60 * 60],
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
  export_data: [10, 60 * 60],
  invite_create: [10, 60 * 60],
  invite_accept: [20, 60 * 60],
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
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return hashKey(ip);
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
