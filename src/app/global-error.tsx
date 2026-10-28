'use client';

import { useEffect, useSyncExternalStore } from 'react';
import * as Sentry from '@sentry/nextjs';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { GLOBAL_ERROR_MESSAGES, detectLocale } from '@/lib/global-error-messages';

// Ultimo paracadute: sostituisce il layout radice, quindi niente provider i18n né componenti UI.
// Le stringhe vengono da una mappa inline; la lingua da cookie / html lang / navigator.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useSyncExternalStore(
    () => () => {},
    () => detectLocale(document.cookie, document.documentElement.lang, navigator.language),
    () => DEFAULT_LOCALE,
  );

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const t = GLOBAL_ERROR_MESSAGES[locale];

  return (
    <html lang={locale}>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2.5rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>{t.title}</h1>
        <p>{t.body}</p>
        <button type="button" onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem', minHeight: 44, minWidth: 44 }}>
          {t.retry}
        </button>
      </body>
    </html>
  );
}
