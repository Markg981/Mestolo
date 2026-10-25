/**
 * Estrae l'IP del client da headers che il client NON puo falsificare.
 * - Su Vercel la piattaforma imposta x-vercel-forwarded-for / x-real-ip (sovrascrivendo quelli del client).
 * - Altrove si legge x-forwarded-for dal fondo: i proxy fidati aggiungono il proprio hop in coda,
 *   mentre i valori in testa possono essere inventati dal client. TRUSTED_PROXY_COUNT (default 1)
 *   indica quanti proxy fidati stanno davanti all'app.
 */
export function extractClientIp(
  h: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string {
  const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0].trim();
  if (vercel) return vercel;
  if (env.VERCEL) {
    const real = h.get('x-real-ip')?.trim();
    if (real) return real;
  }
  const parsed = Number.parseInt(env.TRUSTED_PROXY_COUNT ?? '', 10);
  const trusted = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const hops = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Meno hop dei proxy attesi: la catena non e affidabile, usa il primo disponibile da destra.
  return hops[Math.max(hops.length - trusted, 0)] ?? 'unknown';
}
