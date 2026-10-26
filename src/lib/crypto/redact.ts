/**
 * Pure redaction helpers: no `node:crypto`, so they are safe to bundle for the
 * browser and the Edge runtime (used by the Sentry scrubbing chain).
 */

/** Redacts anything that looks like an API key from a string (for logs/errors). */
export function redactSecrets(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***')
    .replace(/(api[_-]?key|authorization|x-api-key)(["'\s:=]+)(Bearer\s+)?[A-Za-z0-9_\-.]{8,}/gi, '$1$2***')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, 'AIza***');
}
