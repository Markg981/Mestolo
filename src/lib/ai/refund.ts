import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { QuotaGroup, ResolvedProvider } from './service';

/**
 * Restituisce la quota consumata da resolveProvider quando la richiesta poi fallisce
 * (solo provider in errore, mai dopo aver ottenuto output). No-op con chiave personale. Best effort:
 * un errore di rimborso non deve mascherare l'errore originale.
 * La RPC e' eseguibile solo dal service role: userId e' quello noto al server.
 */
export async function refundQuota(userId: string, resolved: ResolvedProvider, group: QuotaGroup, action: string): Promise<void> {
  if (resolved.keySource !== 'app') return;
  try {
    await createAdminClient().rpc('refund_ai_quota', {
      p_user_id: userId,
      p_group: group,
      p_action: action,
      ...((resolved.quantity ?? 1) > 1 ? { p_qty: resolved.quantity } : {}),
    });
  } catch {
    // ignorato di proposito
  }
}

/**
 * Esegue `run` (la chiamata AI e cio' che ne dipende). La quota si rimborsa SOLO se la chiamata
 * al provider fallisce (eccezione prima che `run` chiami `paid()`, cioe' prima di ottenere output).
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
    if (!called) await refundQuota(userId, resolved, group, action);
    throw e;
  }
}
