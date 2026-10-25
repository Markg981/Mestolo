'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Ultimo paracadute: sostituisce il layout radice, quindi niente provider i18n né componenti UI.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="it">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2.5rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Questa pagina non si è caricata</h1>
        <p>Si è verificato un errore imprevisto. Riprova.</p>
        <button type="button" onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
          Riprova
        </button>
      </body>
    </html>
  );
}
