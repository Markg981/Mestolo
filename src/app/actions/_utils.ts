import 'server-only';
import { ConfigError } from '@/lib/env';
import { RateLimitedError } from '@/lib/rate-limit';
import { AiError } from '@/lib/ai/providers';
import { UnsafeUrlError } from '@/lib/import/ssrf';
import { FetchFailedError } from '@/lib/import/safe-fetch';
import { redactSecrets } from '@/lib/crypto/secrets';

/** Error codes map to messages under "errors.<code>" in the i18n files. */
export type ErrorCode =
  | 'generic'
  | 'not_found'
  | 'forbidden'
  | 'invalid_input'
  | 'rate_limited'
  | 'config'
  | 'ai_not_configured'
  | 'ai_quota_exceeded'
  | 'ai_invalid_key'
  | 'ai_provider_rate_limited'
  | 'ai_provider_quota'
  | 'ai_provider_error'
  | 'ai_bad_output'
  | 'ai_timeout'
  | 'ai_unsupported'
  | 'url_invalid'
  | 'url_blocked'
  | 'url_unreachable'
  | 'url_timeout'
  | 'url_http_error'
  | 'url_not_html'
  | 'url_no_recipe'
  | 'image_invalid'
  | 'image_too_large'
  | 'too_many_files'
  | 'auth_invalid'
  | 'auth_email_taken'
  | 'auth_weak_password'
  | 'auth_wrong_password'
  | 'auth_not_confirmed'
  | 'username_taken'
  | 'translation_failed'
  | 'already_exists';

export type ActionResult<T = undefined> = ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T })) | { ok: false; error: ErrorCode; detail?: string };

export function ok(): ActionResult;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T) {
  return { ok: true, data } as ActionResult<T>;
}

export function fail(error: ErrorCode, detail?: string): { ok: false; error: ErrorCode; detail?: string } {
  return { ok: false, error, detail };
}

/** Converts known exceptions to error codes; logs the rest WITHOUT user content or secrets. */
export function toFailure(e: unknown, context: string): { ok: false; error: ErrorCode } {
  if (e instanceof RateLimitedError) return fail('rate_limited');
  if (e instanceof ConfigError) return fail('config');
  if (e instanceof AiError) {
    const map: Record<string, ErrorCode> = {
      not_configured: 'ai_not_configured',
      quota_exceeded: 'ai_quota_exceeded',
      invalid_key: 'ai_invalid_key',
      provider_rate_limited: 'ai_provider_rate_limited',
      provider_quota: 'ai_provider_quota',
      provider_error: 'ai_provider_error',
      bad_output: 'ai_bad_output',
      timeout: 'ai_timeout',
      unsupported: 'ai_unsupported',
    };
    return fail(map[e.code] ?? 'ai_provider_error');
  }
  if (e instanceof UnsafeUrlError) return fail(e.code === 'invalid_url' ? 'url_invalid' : e.code === 'dns' ? 'url_unreachable' : 'url_blocked');
  if (e instanceof FetchFailedError) {
    const map: Record<string, ErrorCode> = { timeout: 'url_timeout', http_error: 'url_http_error', content_type: 'url_not_html', too_large: 'url_not_html', network: 'url_unreachable' };
    return fail(map[e.code] ?? 'url_unreachable');
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[mestolo] ${context}: ${redactSecrets(msg).slice(0, 200)}`);
  return fail('generic');
}

/** Postgres/PostgREST error → code (RLS violations are reported as forbidden). */
export function dbFailure(error: { code?: string; message?: string } | null, context: string) {
  if (!error) return fail('generic');
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) return fail('forbidden');
  if (error.code === 'RL001') return fail('rate_limited');
  if (error.code === '23505') return fail('already_exists');
  if (error.code === '22023' || error.code === '23514' || error.code === '22P02') return fail('invalid_input');
  console.error(`[mestolo] ${context}: db error ${error.code ?? ''}`);
  return fail('generic');
}
