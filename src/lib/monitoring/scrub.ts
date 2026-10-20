import { redactSecrets } from '@/lib/crypto/secrets';

/**
 * Data scrubbing for error monitoring (Sentry). Builds on `redactSecrets`, the
 * same redaction used for server logs, and adds emails, tokens, cookies and
 * recipe text. Pure functions: no Sentry import, so they are easy to test.
 */

const REDACTED = '[redatto]';

/** Keys whose value is dropped whole, wherever they appear in the event. */
const SENSITIVE_KEY =
  /^(cookie|set-cookie|cookies|authorization|proxy-authorization|x-api-key|apikey|api_key|token|access_token|refresh_token|id_token|password|secret|session|email|ingredients|instructions|steps|description|notes|recipe|recipe_text|text|body|content|prompt|data|query_string)$/i;

export function redactText(s: string): string {
  return redactSecrets(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(
      /([?&;\s](?:access_token|refresh_token|token|code|key|apikey|api_key|password)=)[^&\s;]+/gi,
      '$1***',
    )
    .slice(0, 2000);
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

type Loose = Record<string, unknown>;

/** Scrubs a Sentry event (beforeSend): keeps stack frames, drops personal data. Returns a copy. */
export function scrubEvent<T extends object>(event: T): T {
  const e = { ...(event as Loose) };
  const req = e.request as Loose | undefined;
  if (req) {
    const { headers, url, ...other } = req;
    const rest = Object.fromEntries(
      Object.entries(other).filter(([k]) => !['cookies', 'data', 'query_string'].includes(k)),
    );
    e.request = {
      ...(scrubValue(rest) as Loose),
      ...(typeof url === 'string' ? { url: redactText(url.split('?')[0]) } : {}),
      ...(headers ? { headers: scrubValue(headers) } : {}),
    };
  }
  const user = e.user as Loose | undefined;
  if (user) e.user = typeof user.id === 'string' ? { id: user.id } : undefined;
  for (const key of ['message', 'transaction', 'logentry', 'extra', 'contexts', 'tags', 'breadcrumbs', 'exception', 'threads']) {
    if (e[key] !== undefined) e[key] = scrubValue(e[key]);
  }
  return e as T;
}

export function scrubBreadcrumb<T extends object>(crumb: T): T {
  const c = crumb as Loose;
  // Console output may contain recipe text: keep the breadcrumb, not its payload.
  if (c.category === 'console') {
    return { ...c, message: redactText(String(c.message ?? '')), data: undefined } as T;
  }
  return scrubValue(c) as T;
}

/** Shared init options; without a DSN the SDK stays fully disabled. */
export function sentryOptions(dsn: string | undefined) {
  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.05,
    beforeSend: <T extends object>(e: T): T => scrubEvent(e),
    beforeSendTransaction: <T extends object>(e: T): T => scrubEvent(e),
    beforeBreadcrumb: <T extends object>(b: T): T => scrubBreadcrumb(b),
  };
}
