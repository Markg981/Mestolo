import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/monitoring/scrub';

export async function register() {
  // Inactive unless a DSN is configured.
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(sentryOptions(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN));
  }
}

export const onRequestError = Sentry.captureRequestError;
