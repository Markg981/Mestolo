import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { QuotaGroup, ResolvedProvider } from './service';

/**
 * Restituisce la quota consumata da resolveProvider quando la richiesta poi fallisce
 * (provider in errore, output non valido). No-op con chiave personale. Best effort:
 * un errore di rimborso non deve mascherare l'errore originale.
 */
export async function refundQuota(resolved: ResolvedProvider, group: QuotaGroup, action: string): Promise<void> {
  if (resolved.keySource !== 'app') return;
  try {
    const supabase = await createClient();
    await supabase.rpc('refund_ai_quota', { p_group: group, p_action: action });
  } catch {
    // ignorato di proposito
  }
}
