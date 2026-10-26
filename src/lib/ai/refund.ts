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
