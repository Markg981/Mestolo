/**
 * Estrae l'IP del client da headers che il client NON puo falsificare.
 * - Su Vercel la piattaforma imposta x-vercel-forwarded-for / x-real-ip (sovrascrivendo quelli del client).
 * - Altrove si legge x-forwarded-for dal fondo: i proxy fidati aggiungono il proprio hop in coda,
 *   mentre i valori in testa possono essere inventati dal client. TRUSTED_PROXY_COUNT (default 1)
 *   indica quanti proxy fidati stanno davanti all'app.
 */
/**
 * Normalizza un IP per i limiti: IPv4 invariato, IPv4-mapped trattato come IPv4,
 * IPv6 ridotto al prefisso /64 (un client controlla un intero /64, non il singolo indirizzo).
 */
export function normalizeIpForRateLimit(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  ip = ip.split('%')[0];
  if (!ip.includes(':')) return ip;
  const mapped = /^(?:0{1,4}:){2,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  const dbl = ip.indexOf('::');
  let groups: string[];
  if (dbl === -1) {
    groups = ip.split(':');
  } else {
    const head = ip.slice(0, dbl);
    const rest = ip.slice(dbl + 2);
    const headParts = head === '' ? [] : head.split(':');
    const tail = rest === '' ? [] : rest.split(':');
    const fill = 8 - headParts.length - tail.length;
    if (fill < 1) return raw.trim();
    groups = [...headParts, ...Array<string>(fill).fill('0'), ...tail];
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw.trim();
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}

/** Valore restituito quando l'IP non e determinabile. */
export const UNKNOWN_IP = 'unknown';

export function extractClientIp(
  h: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string {
  // Gli header Vercel sono affidabili solo se siamo davvero su Vercel: altrove li imposta il client.
  if (env.VERCEL) {
    const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0].trim();
    if (vercel) return normalizeIpForRateLimit(vercel);
    const real = h.get('x-real-ip')?.trim();
    if (real) return normalizeIpForRateLimit(real);
  }
  const parsed = Number.parseInt(env.TRUSTED_PROXY_COUNT ?? '', 10);
  // 0 = nessun proxy davanti all'app: x-forwarded-for e interamente controllato dal client, quindi si ignora.
  if (parsed === 0) return UNKNOWN_IP;
  const trusted = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const hops = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Meno hop dei proxy attesi: la catena non e affidabile, usa il primo disponibile da destra.
  const picked = hops[Math.max(hops.length - trusted, 0)];
  return picked ? normalizeIpForRateLimit(picked) : UNKNOWN_IP;
}

/**
 * Avviso all'avvio: in produzione fuori da Vercel senza TRUSTED_PROXY_COUNT si assume 1 proxy,
 * ipotesi che se errata rende l'IP falsificabile. Solo avviso (non fail-fast): un fail-fast
 * romperebbe deploy legittimi dietro un singolo proxy, che e il default.
 */
export function proxyConfigWarning(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV !== 'production' || env.VERCEL) return null;
  if (env.TRUSTED_PROXY_COUNT !== undefined && env.TRUSTED_PROXY_COUNT.trim() !== '') return null;
  return '[mestolo] TRUSTED_PROXY_COUNT non impostato fuori da Vercel: si assume 1 proxy fidato. Impostalo (0 = nessun proxy) per evitare IP falsificabili nei rate limit.';
}
