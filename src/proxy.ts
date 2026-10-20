import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { buildCsp, cspHeaderName, generateNonce } from '@/lib/csp';

const PUBLIC_PATHS = ['/welcome', '/login', '/signup', '/forgot-password', '/auth', '/setup', '/privacy', '/terms', '/offline'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * anonymous users to the welcome page. Authorization itself is enforced by
 * RLS in the database and re-checked in every server action / route.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== 'production',
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const cspName = cspHeaderName(process.env.CSP_REPORT_ONLY === '1');
  // Next reads the nonce from the request CSP header to tag its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(cspName, csp);
  const next = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set(cspName, csp);
    return res;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  if (!url || !anon) {
    if (pathname.startsWith('/setup') || pathname.startsWith('/api')) return next();
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  let response = next();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname) && !pathname.startsWith('/api')) {
    const to = request.nextUrl.clone();
    to.pathname = pathname === '/' ? '/welcome' : '/login';
    to.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  if (user && (pathname === '/login' || pathname === '/signup' || pathname === '/welcome')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|ocr/|sw.js|manifest.webmanifest|fonts/|\\.well-known/).*)'],
};
