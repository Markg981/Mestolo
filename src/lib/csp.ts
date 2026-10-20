// Content-Security-Policy with a per-request nonce, built in proxy.ts.
// Data and AI calls go through our server; the only direct browser link to
// Supabase is the Realtime websocket (user-scoped, RLS-filtered), so connect-src
// is 'self' plus the Sentry ingest origin (public DSN only) and the Supabase
// https/wss origins (the browser client also refreshes tokens over https).

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

function sentryOrigin(dsn: string | undefined): string {
  try {
    return dsn ? new URL(dsn).origin : '';
  } catch {
    // invalid DSN: Sentry stays inactive and the CSP is unchanged
    return '';
  }
}

function supabaseOrigins(url: string | undefined): string[] {
  try {
    if (!url) return [];
    const u = new URL(url);
    return [u.origin, `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}`];
  } catch {
    return [];
  }
}

export type CspOptions = {
  nonce: string;
  isDev?: boolean;
  sentryDsn?: string;
  supabaseUrl?: string;
};

export function buildCsp({ nonce, isDev = false, sentryDsn, supabaseUrl }: CspOptions): string {
  const connect = ["'self'", sentryOrigin(sentryDsn), ...supabaseOrigins(supabaseUrl)].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    // On-device OCR (Tesseract.js) runs in a same-origin worker served from /ocr (self-hosted, no CDN).
    "worker-src 'self'",
    // Inline styles are still needed for style attributes set by React/Next.
    "style-src 'self' 'unsafe-inline'",
    // https: is needed only to preview the source image of an imported recipe
    // in the review screen (it is never copied without the user's choice).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** CSP_REPORT_ONLY=1 switches to the non-enforcing header for a safe rollout. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}
