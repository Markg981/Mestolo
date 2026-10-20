import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs/config';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

// The browser never talks to Supabase or AI providers directly: every call
// goes through our server, so connect-src stays 'self' plus the Sentry ingest
// origin, and only when a public DSN is configured.
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let sentryOrigin = '';
try {
  if (sentryDsn) sentryOrigin = ` ${new URL(sentryDsn).origin}`;
} catch {
  // invalid DSN: Sentry stays inactive and the CSP is unchanged
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // https: is needed only to preview the source image of an imported recipe
  // in the review screen (it is never copied without the user's choice).
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${sentryOrigin}`,
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Photo import pages are compressed client-side; keep below Vercel's 4.5 MB limit.
      bodySizeLimit: '4mb',
    },
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

// Without SENTRY_AUTH_TOKEN nothing is uploaded; the wrapper only wires the SDK.
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
