import { describe, expect, it } from 'vitest';
import { buildCsp, cspHeaderName, cspReportOnlyWarning, generateNonce } from '@/lib/csp';

describe('buildCsp', () => {
  it('usa nonce e strict-dynamic senza unsafe-inline negli script', () => {
    const csp = buildCsp({ nonce: 'abc' });
    const script = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('limita img-src a self, data e blob senza https generico', () => {
    const img = buildCsp({ nonce: 'a' }).split('; ').find((d) => d.startsWith('img-src'));
    expect(img).toBe("img-src 'self' data: blob:");
  });

  it('consente unsafe-eval solo in sviluppo', () => {
    expect(buildCsp({ nonce: 'a', isDev: true })).toContain("'unsafe-eval'");
    expect(buildCsp({ nonce: 'a' })).not.toContain("'unsafe-eval'");
  });

  it('aggiunge l origine Sentry solo con DSN valido', () => {
    const dsn = 'https://key@o1.ingest.sentry.io/123';
    expect(buildCsp({ nonce: 'a', sentryDsn: dsn })).toContain("connect-src 'self' https://o1.ingest.sentry.io;");
    expect(buildCsp({ nonce: 'a', sentryDsn: 'non-url' })).toContain("connect-src 'self';");
  });

  it('aggiunge https e wss di Supabase solo con URL valido', () => {
    const csp = buildCsp({ nonce: 'a', supabaseUrl: 'https://abc.supabase.co' });
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co;");
    expect(buildCsp({ nonce: 'a', supabaseUrl: 'http://localhost:54321' })).toContain('ws://localhost:54321');
    expect(buildCsp({ nonce: 'a', supabaseUrl: 'non-url' })).toContain("connect-src 'self';");
  });
});

describe('nonce e header', () => {
  it('genera nonce diversi a ogni chiamata', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });
  it('sceglie il nome header in base al report-only', () => {
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName(false)).toBe('Content-Security-Policy');
  });
});

describe('CSP reporting', () => {
  it('include report-uri e report-to', () => {
    const csp = buildCsp({ nonce: 'a' });
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp-endpoint');
  });

  it('avvisa solo se report-only e produzione', () => {
    expect(cspReportOnlyWarning(true, true)).toContain('CSP_REPORT_ONLY');
    expect(cspReportOnlyWarning(true, false)).toBeNull();
    expect(cspReportOnlyWarning(false, true)).toBeNull();
  });
});
