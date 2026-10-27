import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
type CookieAdapter = { getAll(): unknown; setAll(c: { name: string; value: string; options?: object }[], headers?: Record<string, string>): void };
let capturedCookies: CookieAdapter | undefined;
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: CookieAdapter }) => {
    capturedCookies = opts.cookies;
    return { auth: { getUser } };
  },
}));

import { config, proxy } from '@/proxy';

const call = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => proxy(new NextRequest(`https://mestolo.test${path}`, init));
const loc = (res: Response) => res.headers.get('location');
const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy')!)![1];

describe('proxy', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('CSP_REPORT_ONLY', '');
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
    capturedCookies = undefined;
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('anonymous user', () => {
    it('sends / to /welcome without a next param', async () => {
      const res = await call('/');
      expect(res.status).toBe(307);
      expect(loc(res)).toBe('https://mestolo.test/welcome');
    });

    it('sends a protected page to /login keeping path and query in next', async () => {
      const res = await call('/recipes/1?tab=notes');
      expect(loc(res)).toBe(`https://mestolo.test/login?next=${encodeURIComponent('/recipes/1?tab=notes')}`);
    });

    it.each(['/welcome', '/login', '/signup', '/forgot-password', '/auth/callback', '/setup', '/privacy', '/terms', '/offline', '/invite/abc', '/r/xyz', '/sitemap.xml', '/robots.txt'])(
      'lets %s through',
      async (p) => {
        const res = await call(p);
        expect(res.status).toBe(200);
        expect(loc(res)).toBeNull();
      },
    );

    it('does not treat look-alike prefixes as public', async () => {
      for (const p of ['/loginx', '/rx', '/authorize', '/terms-of-evil']) {
        expect(loc(await call(p))).toContain('/login?next=');
      }
    });

    it('does not redirect /api routes (they answer 401 themselves)', async () => {
      const res = await call('/api/images/1');
      expect(res.status).toBe(200);
      expect(loc(res)).toBeNull();
    });
  });

  describe('authenticated user', () => {
    beforeEach(() => getUser.mockResolvedValue({ data: { user: { id: 'u1' } } }));

    it.each(['/login', '/signup', '/welcome'])('bounces %s to /', async (p) => {
      expect(loc(await call(p))).toBe('https://mestolo.test/');
    });

    it('lets protected pages through', async () => {
      const res = await call('/recipes');
      expect(res.status).toBe(200);
      expect(loc(res)).toBeNull();
    });

    it('keeps other public pages reachable (e.g. /privacy, /auth/callback)', async () => {
      expect(loc(await call('/privacy'))).toBeNull();
      expect(loc(await call('/auth/callback?code=x'))).toBeNull();
    });
  });

  describe('missing Supabase configuration', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    });

    it('redirects pages to /setup without calling Supabase', async () => {
      expect(loc(await call('/recipes'))).toBe('https://mestolo.test/setup');
      expect(getUser).not.toHaveBeenCalled();
    });

    it('lets /setup and /api through', async () => {
      expect(loc(await call('/setup'))).toBeNull();
      expect(loc(await call('/api/health'))).toBeNull();
    });
  });

  describe('security headers', () => {
    it('sets an enforcing CSP whose nonce matches the x-nonce forwarded to the app', async () => {
      const res = await call('/login');
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('https://abc.supabase.co');
      expect(res.headers.get('content-security-policy-report-only')).toBeNull();
      expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(res));
      expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    });

    it('uses a different nonce on every request', async () => {
      expect(nonceOf(await call('/login'))).not.toBe(nonceOf(await call('/login')));
    });

    it('switches to Report-Only when CSP_REPORT_ONLY=1', async () => {
      vi.stubEnv('CSP_REPORT_ONLY', '1');
      const res = await call('/login');
      expect(res.headers.get('content-security-policy-report-only')).toContain("default-src 'self'");
      expect(res.headers.get('content-security-policy')).toBeNull();
    });

    it('does not let a client-supplied x-nonce survive', async () => {
      const res = await call('/login', { headers: { 'x-nonce': 'attacker' } });
      expect(res.headers.get('x-middleware-request-x-nonce')).not.toBe('attacker');
    });
  });

  describe('session cookie refresh', () => {
    it('writes refreshed cookies on the response and keeps the CSP on the rebuilt response', async () => {
      getUser.mockImplementation(async () => {
        capturedCookies!.setAll([{ name: 'sb-token', value: 'new', options: { path: '/' } }]);
        return { data: { user: { id: 'u1' } } };
      });
      const res = await call('/recipes');
      expect(res.cookies.get('sb-token')?.value).toBe('new');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    });

    it('applies the cache headers passed to setAll so a refreshed session is never cached', async () => {
      getUser.mockImplementation(async () => {
        capturedCookies!.setAll([{ name: 'sb-token', value: 'new', options: { path: '/' } }], {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
          Expires: '0',
          Pragma: 'no-cache',
        });
        return { data: { user: { id: 'u1' } } };
      });
      const res = await call('/api/public-images/1');
      expect(res.cookies.get('sb-token')?.value).toBe('new');
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    });

    it('reads cookies from the incoming request', async () => {
      await call('/login', { headers: { cookie: 'sb-token=abc' } });
      expect(capturedCookies!.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
    });
  });

  describe('matcher', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    it('skips static assets and well-known files', () => {
      for (const p of ['/_next/static/a.js', '/_next/image', '/favicon.ico', '/icons/a.png', '/sw.js', '/manifest.webmanifest', '/fonts/a.woff2', '/ocr/w.js']) {
        expect(re.test(p)).toBe(false);
      }
    });
    it('runs on pages and API routes', () => {
      for (const p of ['/', '/recipes', '/api/images/1', '/auth/callback']) expect(re.test(p)).toBe(true);
    });
  });
});
