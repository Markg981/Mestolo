import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs/config';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The Content-Security-Policy (with a per-request nonce) is set in src/proxy.ts.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Keep below Vercel's 4.5 MB limit and above MAX_TOTAL_BYTES + MULTIPART_MARGIN_BYTES (src/lib/import/limits.ts, BODY_SIZE_LIMIT_BYTES: keep in sync).
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
