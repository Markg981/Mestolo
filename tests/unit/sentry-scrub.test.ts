import { describe, expect, it } from 'vitest';
import { scrubSpan, scrubBreadcrumb, scrubEvent, sentryOptions } from '@/lib/monitoring/scrub';

describe('scrubEvent', () => {
  const event = {
    message: 'Errore per mario@example.com con sk-abcdefgh12345678',
    user: { id: 'u1', email: 'mario@example.com', ip_address: '1.2.3.4' },
    request: {
      url: 'https://mestolo.app/it/ricette?token=abc12345678',
      cookies: { sb: 'x' },
      headers: { cookie: 'sb=secret', authorization: 'Bearer abcdefghijkl', accept: 'text/html' },
      data: { ingredients: '200 g farina' },
    },
    extra: { ingredients: ['farina'], title: 'ok', note: 'Bearer abcdefghijklmnop' },
    exception: { values: [{ value: 'fail eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJl user a@b.it' }] },
  };

  it('toglie email, token, cookie e testo delle ricette', () => {
    const s = JSON.stringify(scrubEvent(event));
    for (const leak of [
      'mario@example.com',
      'sk-abcdefgh12345678',
      'abc12345678',
      'sb=secret',
      'abcdefghijkl',
      '200 g farina',
      'farina',
      'eyJhbGciOiJIUzI1',
      'a@b.it',
      '1.2.3.4',
    ]) {
      expect(s).not.toContain(leak);
    }
  });

  it('mantiene i dati utili per il debug', () => {
    const out = scrubEvent(event);
    expect(out.user).toEqual({ id: 'u1' });
    expect(out.request.url).toBe('https://mestolo.app/it/ricette');
    expect(out.request.headers.accept).toBe('text/html');
    expect(out.extra.title).toBe('ok');
  });

  it("non modifica l'evento originale", () => {
    scrubEvent(event);
    expect(event.user.email).toBe('mario@example.com');
  });
});

describe('scrubSpan / spans di una transazione', () => {
  const url = 'https://x.supabase.co/rest/v1/profiles?select=id&username=eq.mario_rossi';
  const span = {
    op: 'http.client',
    description: `GET ${url}`,
    data: {
      url,
      'url.full': url,
      'http.query': '?username=eq.mario_rossi',
      'http.method': 'GET',
      'http.response.status_code': 200,
    },
  };

  it('toglie la query string da description e data', () => {
    const out = scrubSpan(span);
    expect(JSON.stringify(out)).not.toContain('mario_rossi');
    expect(out.description).toBe('GET https://x.supabase.co/rest/v1/profiles');
    expect(out.data.url).toBe('https://x.supabase.co/rest/v1/profiles');
    expect(out.data['http.method']).toBe('GET');
    expect(out.data['http.response.status_code']).toBe(200);
  });

  it('scrubEvent applica lo scrubbing a event.spans', () => {
    const out = scrubEvent({ type: 'transaction', spans: [span] });
    expect(JSON.stringify(out)).not.toContain('mario_rossi');
    expect(out.spans[0].description).toBe('GET https://x.supabase.co/rest/v1/profiles');
  });

  it("non modifica lo span originale", () => {
    scrubSpan(span);
    expect(span.data.url).toBe(url);
  });
});

describe('scrubBreadcrumb', () => {
  it('toglie il payload dei breadcrumb della console', () => {
    const b = scrubBreadcrumb({ category: 'console', message: 'x a@b.it', data: { arguments: ['ricetta'] } });
    expect(b).toEqual({ category: 'console', message: 'x [email]', data: undefined });
  });
  it('redige gli altri breadcrumb', () => {
    const b = scrubBreadcrumb({ category: 'fetch', data: { url: '/a?token=abcdefgh123' } });
    expect(JSON.stringify(b)).not.toContain('abcdefgh123');
  });
});

describe('sentryOptions', () => {
  it('è disattivato senza DSN e non invia PII', () => {
    const o = sentryOptions(undefined);
    expect(o.enabled).toBe(false);
    expect(o.dsn).toBeUndefined();
    expect(o.sendDefaultPii).toBe(false);
    expect(o.tracesSampleRate).toBeLessThanOrEqual(0.1);
  });
  it('si attiva con un DSN', () => {
    expect(sentryOptions('https://k@o1.ingest.sentry.io/1').enabled).toBe(true);
  });
});
