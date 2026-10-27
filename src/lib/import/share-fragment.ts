import { sharedToImportPath } from '@/lib/import/share';

/** Chiave sessionStorage usata per passare il testo condiviso a /import/text senza metterlo nell'URL. */
export const SHARED_TEXT_KEY = 'mestolo:shared-text';

/**
 * Legge url/text/title dal fragment (`#text=...&title=...`) usato dall'app Android: il fragment
 * non viene mai inviato al server (niente log, niente Referer).
 */
export function parseShareFragment(hash: string): { url: string | null; text: string | null; title: string | null } {
  const p = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return { url: p.get('url'), text: p.get('text'), title: p.get('title') };
}

/**
 * Decide dove andare. Un link condiviso va nell'URL di /import/link (e' pubblico e serve al server);
 * il testo libero, che puo' contenere dati personali, viaggia solo in `text` e mai nell'URL.
 */
export function resolveShareTarget(hash: string): { path: string; text: string | null } {
  const path = sharedToImportPath(parseShareFragment(hash));
  if (!path.startsWith('/import/text?text=')) return { path, text: null };
  return { path: '/import/text', text: decodeURIComponent(path.slice('/import/text?text='.length)) };
}
