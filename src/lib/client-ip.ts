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
  const trusted = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const hops = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Meno hop dei proxy attesi: la catena non e affidabile, usa il primo disponibile da destra.
  const picked = hops[Math.max(hops.length - trusted, 0)];
  return picked ? normalizeIpForRateLimit(picked) : 'unknown';
}
