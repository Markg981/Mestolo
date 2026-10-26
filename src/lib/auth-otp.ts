import type { EmailOtpType } from '@supabase/supabase-js';

/** OTP types the app actually emails: signup confirmation, password recovery, email change. */
const ALLOWED = ['signup', 'recovery', 'email_change', 'email'] as const;

/** Returns the type if allow-listed, otherwise null (callers must reject). */
export function parseOtpType(value: unknown): EmailOtpType | null {
  return typeof value === 'string' && (ALLOWED as readonly string[]).includes(value)
    ? (value as EmailOtpType)
    : null;
}
