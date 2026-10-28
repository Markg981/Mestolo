import * as Sentry from '@sentry/nextjs';
import { clientIpHash, enforceRateLimit } from '@/lib/rate-limit';
import { parseCspReports } from '@/lib/csp-report';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/**
 * Riceve le violazioni CSP (report-uri / report-to). Endpoint pubblico: i browser inviano i report
 * senza credenziali. Risponde sempre 204 (anche se limitato o malformato) per non dare segnali.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit('csp_report', await clientIpHash());
  } catch {
    return noContent();
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return noContent();
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    payload = JSON.parse(text);
  } catch {
    return noContent();
  }
  for (const v of parseCspReports(payload)) {
    console.warn('[mestolo] violazione CSP', v);
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureMessage(`CSP violation: ${v.directive || 'unknown'}`, {
        level: 'warning',
        tags: { csp_directive: v.directive || 'unknown' },
        extra: { ...v },
      });
    }
  }
  return noContent();
}
