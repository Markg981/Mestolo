import { describe, expect, it } from 'vitest';
import { buildCsp, cspHeaderName, generateNonce } from '@/lib/csp';

describe('buildCsp', () => {
  it('usa nonce e strict-dynamic senza unsafe-inline negli script', () => {
    const csp = buildCsp({ nonce: 'abc' });
    const script = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
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
