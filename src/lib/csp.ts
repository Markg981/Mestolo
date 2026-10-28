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

/** Endpoint che riceve le violazioni CSP (src/app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp-endpoint';
/** Valore dell'header Reporting-Endpoints richiesto da report-to. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

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
    // 'unsafe-inline' resta per gli stili: React/Next e le librerie UI emettono attributi style=""
    // e tag <style> inline. Un nonce in style-src invaliderebbe 'unsafe-inline' e romperebbe gli
    // attributi style (che i nonce non coprono). Il rischio residuo e' basso: gli script restano
    // protetti da nonce + strict-dynamic. Rivalutare se Next smette di iniettare stili inline.
    "style-src 'self' 'unsafe-inline'",
    // Tutte le immagini passano da route same-origin (/api/images, /api/avatars,
    // /api/public-images...) o da data:/blob: (anteprime locali). Nessun https:
    // generico: l'immagine sorgente di una ricetta importata non viene mostrata
    // da URL remoto (la sua copia avviene lato server con safeFetch).
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join('; ');
}

/** CSP_REPORT_ONLY=1 switches to the non-enforcing header for a safe rollout. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

export function cspReportOnlyWarning(reportOnly: boolean, isProduction: boolean): string | null {
/** Avviso da loggare all'avvio se la CSP e' solo in modalita' report in produzione (altrimenti nulla viene bloccato in silenzio). */
  return reportOnly && isProduction
    ? "[mestolo] CSP_REPORT_ONLY=1 in produzione: la Content-Security-Policy NON è applicata (solo report). Rimuovere la variabile per attivare l'enforcement."
    : null;
}
