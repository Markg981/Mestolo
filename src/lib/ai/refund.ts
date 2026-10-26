import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { QuotaGroup, ResolvedProvider } from './service';

/**
 * Restituisce la quota consumata da resolveProvider quando la richiesta poi fallisce
 * (provider in errore, output non valido). No-op con chiave personale. Best effort:
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
 * Esegue `run` (la chiamata AI e cio' che ne dipende) e rimborsa la quota se l'azione non
 * produce nulla: eccezione, oppure risultato `{ ok: false }` (output non valido, salvataggio
 * fallito). Nessun rimborso in caso di successo. L'errore originale o il risultato di
 * fallimento vengono sempre restituiti intatti.
 */
export async function withRefund<T>(userId: string, resolved: ResolvedProvider, group: QuotaGroup, action: string, run: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (e) {
    await refundQuota(userId, resolved, group, action);
    throw e;
  }
  if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) await refundQuota(userId, resolved, group, action);
  return result;
}
