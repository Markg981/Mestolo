import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforce = vi.fn();
const capture = vi.fn();
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: (...a: unknown[]) => enforce(...a), clientIpHash: async () => 'h' }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => capture(...a) }));

import { POST } from '@/app/api/csp-report/route';
import { parseCspReports } from '@/lib/csp-report';

const req = (body: string) => new Request('http://x/api/csp-report', { method: 'POST', body });
const legacy = JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://evil.test/x.js', 'violated-directive': 'script-src', 'document-uri': 'https://m.test/' } });

describe('parseCspReports', () => {
  it('legge il formato legacy e quello Reporting API, ignora il resto', () => {
    expect(parseCspReports(JSON.parse(legacy))[0].directive).toBe('script-src');
    const api = [{ type: 'csp-violation', body: { blockedURL: 'inline', effectiveDirective: 'style-src' } }, { type: 'other', body: {} }];
    const out = parseCspReports(api);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ blockedUri: 'inline', directive: 'style-src' });
    expect(parseCspReports('x')).toEqual([]);
  });
});

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    enforce.mockReset().mockResolvedValue(undefined);
    capture.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.unstubAllEnvs();
  });

  it('risponde 204 e logga la violazione', async () => {
    const res = await POST(req(legacy));
    expect(res.status).toBe(204);
    expect(console.warn).toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('invia a Sentry se configurato', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@o.ingest.sentry.io/1');
    await POST(req(legacy));
    expect(capture).toHaveBeenCalledOnce();
  });

  it('204 senza loggare se rate limited, malformato o troppo grande', async () => {
    enforce.mockRejectedValueOnce(new Error('rate_limited'));
    expect((await POST(req(legacy))).status).toBe(204);
    expect((await POST(req('{non json'))).status).toBe(204);
    expect((await POST(req('x'.repeat(20000)))).status).toBe(204);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
