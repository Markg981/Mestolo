import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { QuotaGroup, ResolvedProvider } from './service';

/**
 * Codici AiError per cui il provider ha CERTAMENTE rifiutato la richiesta prima di elaborarla
 * (nessun addebito): chiave non valida (401/403), rate limit (429), quota/credito esaurito (402/429),
 * provider non configurato o non supportato, chiavi non disponibili, errore HTTP/di rete del provider.
 * Lista esplicita: ogni codice non elencato NON rimborsa.
 * Esclusi di proposito: 'timeout' (il provider puo' aver gia' addebitato la richiesta) e 'bad_output'
 * (il provider ha risposto, quindi ha elaborato e addebitato).
 */
const REFUNDABLE_AI_CODES: ReadonlySet<string> = new Set([
  'invalid_key',
  'provider_rate_limited',
  'provider_quota',
  'provider_error',
  'not_configured',
  'unsupported',
  'keys_unavailable',
]);

/**
 * Dice se un errore della chiamata al provider consente il rimborso. Timeout/abort (AiError 'timeout',
 * TimeoutError/AbortError nativi) e output non valido NON rimborsano; gli altri AiError solo se in lista.
 * Eccezioni generiche (errori nostri prima di ottenere una risposta, es. connessione) rimborsano.
 */
export function isRefundableError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return true;
  const { name, code } = e as { name?: unknown; code?: unknown };
  if (name === 'TimeoutError' || name === 'AbortError') return false;
  if (typeof code === 'string' && e instanceof Error && 'code' in e && /^[a-z_]+$/.test(code)) {
    return REFUNDABLE_AI_CODES.has(code);
  }
  return true;
}

/**
 * Restituisce la quota consumata da resolveProvider quando la richiesta poi fallisce
 * (solo provider in errore, mai dopo aver ottenuto output). No-op con chiave personale. Best effort:
 * un errore di rimborso non deve mascherare l'errore originale.
 * La RPC e' eseguibile solo dal service role: userId e' quello noto al server.
 */
export async function refundQuota(userId: string, resolved: ResolvedProvider, group: QuotaGroup, action: string): Promise<void> {
  if (resolved.keySource !== 'app') return;
  try {
    await createAdminClient().rpc('refund_ai_quota', { p_user_id: userId, p_group: group, p_action: action });
  } catch {
    // ignorato di proposito
  }
}

/**
 * Esegue `run` (la chiamata AI e cio' che ne dipende). La quota si rimborsa SOLO se la chiamata
 * al provider fallisce (eccezione rimborsabile, vedi isRefundableError, prima che `run` chiami `paid()`).
 * Dopo `paid()` il costo e' sostenuto: output non valido, salvataggio fallito o storage pieno
 * (risultati `{ ok: false }` o eccezioni successive) NON rimborsano, altrimenti il tetto
 * giornaliero si aggirerebbe. L'errore originale o il risultato vengono restituiti intatti.
 */
export async function withRefund<T>(userId: string, resolved: ResolvedProvider, group: QuotaGroup, action: string, run: (paid: () => void) => Promise<T>): Promise<T> {
  let called = false;
  try {
    return await run(() => {
      called = true;
    });
  } catch (e) {
    if (!called && isRefundableError(e)) await refundQuota(userId, resolved, group, action);
    throw e;
  }
}
