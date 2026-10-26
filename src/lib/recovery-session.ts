/** Finestra entro cui una sessione nata da un link di recovery puo' impostare la nuova password. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

type AmrEntry = { method?: string; timestamp?: number };

/**
 * True se la sessione e' stata appena creata da un link email di recovery (OTP):
 * il metodo di autenticazione piu' recente nel claim `amr` e' `otp` ed e' recente.
 * Una sessione normale (password, OAuth) o un cookie rubato piu' vecchio non passano.
 */
export function isRecoverySession(claims: { amr?: unknown } | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr) || amr.length === 0) return false;
  let latest: AmrEntry | null = null;
  for (const e of amr as AmrEntry[]) {
    if (e && typeof e.timestamp === 'number' && (!latest || e.timestamp > (latest.timestamp ?? 0))) latest = e;
  }
  if (!latest || latest.method !== 'otp' || typeof latest.timestamp !== 'number') return false;
  return nowSeconds - latest.timestamp <= RECOVERY_WINDOW_SECONDS;
}
