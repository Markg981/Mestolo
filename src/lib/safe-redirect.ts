/**
 * Validazione del parametro `next` usato dopo login, callback auth, conferma
 * email e reset password. Accetta solo percorsi relativi allo stesso origin.
 */
const FALLBACK = '/';
// Origin fittizio usato solo per risolvere e confrontare l'URL.
const BASE = 'http://mestolo.invalid';

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f-\u009f\\]/;

export function safeNextPath(next: unknown, fallback: string = FALLBACK): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return fallback;

  // Controlla sia il testo grezzo sia le versioni decodificate (anche piu volte),
  // cosi %2f%2f, %5c, %0d%0a, %252f ecc. non passano.
  let current = next;
  for (let i = 0; i < 4; i++) {
    if (CONTROL_OR_BACKSLASH.test(current)) return fallback;
    if (!current.startsWith('/') || current.startsWith('//')) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return fallback;
    }
    if (decoded === current) break;
    current = decoded;
  }

  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
