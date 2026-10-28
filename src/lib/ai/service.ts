import 'server-only';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptWithKeys, encryptSecret, keyAad, loadEncryptionKey, loadPreviousEncryptionKey, SecretDecryptionError } from '@/lib/crypto/secrets';
import { AiError, anthropicProvider, openAiProvider, type AiProvider, type Capability } from './providers';

/**
 * Decides which provider/key serves a request:
 *  1. the user's personal key, if they saved one that supports the capability
 *  2. otherwise the app's "base" service (paid by the operator), if configured,
 *     within per-user daily quotas
 *  3. otherwise: not available (the UI explains it and offers the manual path)
 */
export type KeySource = 'user' | 'app';
export type QuotaGroup = 'text' | 'vision' | 'image' | 'translate';

export interface ResolvedProvider {
  provider: AiProvider;
  keySource: KeySource;
  providerName: string;
  /** Unita di quota consumate con la chiave dell'app (default 1): serve al rimborso. */
  quantity?: number;
}

export interface CapabilityStatus {
  available: boolean;
  keySource: KeySource | null;
  providerName: string | null;
  /** remaining daily uses on the app service (null for personal keys) */
  remainingToday: number | null;
  dailyLimit: number | null;
}

type UserKeyRow = { provider: 'anthropic' | 'openai'; ciphertext: string; iv: string; auth_tag: string };

async function loadUserKeys(userId: string): Promise<UserKeyRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('user_api_keys').select('provider, ciphertext, iv, auth_tag').eq('user_id', userId);
  // Mai ripiegare in silenzio sul servizio base: se non sappiamo se l'utente ha una chiave, errore esplicito.
  if (error) throw new AiError('keys_unavailable');
  // Ordine stabile (C-09): con due chiavi di provider diversi la scelta non deve dipendere dall'ordine della query.
  // OpenAI prima perche copre tutte le capability (testo, vision, immagini, audio); poi ordine alfabetico del provider.
  const rank = (p: string) => (p === 'openai' ? 0 : 1);
  return [...((data as UserKeyRow[]) ?? [])].sort((a, b) => rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider));
}

/** Best-effort lazy re-encryption under the current key after a fallback decrypt. */
async function reencryptUserKey(userId: string, provider: string, apiKey: string, key: Buffer, old: UserKeyRow): Promise<void> {
  try {
    const enc = encryptSecret(apiKey, key, keyAad(userId, provider));
    // Compare-and-swap: scrive solo se la riga e' ancora quella letta (stesso ciphertext/iv/auth_tag),
    // cosi' una chiave salvata nel frattempo dall'utente non viene mai sovrascritta.
    const { error } = await createAdminClient()
      .from('user_api_keys')
      .update({ ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('ciphertext', old.ciphertext)
      .eq('iv', old.iv)
      .eq('auth_tag', old.auth_tag);
    if (error) console.error(`[ai] lazy re-encryption of ${provider} key failed for user ${userId}`);
  } catch {
    // Not critical: the previous key keeps working until it is removed.
  }
}

async function userProviderFor(row: UserKeyRow, userId: string, capability: Capability): Promise<AiProvider | null> {
  const cfg = env();
  // Chiave utente presente ma server senza APP_ENCRYPTION_KEY: errore esplicito (EncryptionConfigError), niente ripiego.
  const key = loadEncryptionKey(cfg.encryptionKey);
  const { plaintext: apiKey, usedPrevious } = decryptWithKeys(
    { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
    key,
    loadPreviousEncryptionKey(cfg.encryptionKeyPrevious),
    keyAad(userId, row.provider),
  );
  if (usedPrevious) await reencryptUserKey(userId, row.provider, apiKey, key, row);
  if (row.provider === 'anthropic') {
    if (capability === 'image' || capability === 'audio') return null;
    return anthropicProvider({ apiKey, model: cfg.ai.userAnthropicModel });
  }
  return openAiProvider({ apiKey, textModel: cfg.ai.userOpenaiTextModel, imageModel: cfg.ai.userOpenaiImageModel, transcribeModel: cfg.ai.transcribeModel });
}

function appProvider(capability: Capability): AiProvider | null {
  const { ai } = env();
  if (!ai.appProvider || !ai.appApiKey) return null;
  if (ai.appProvider === 'anthropic') {
    if (capability === 'image' || capability === 'audio') return null;
    return anthropicProvider({ apiKey: ai.appApiKey, model: (capability === 'vision' ? ai.appVisionModel : ai.appTextModel) || ai.userAnthropicModel });
  }
  if (capability === 'image' && (!ai.appImageEnabled || ai.appProvider !== 'openai')) return null;
  return openAiProvider({
    apiKey: ai.appApiKey,
    textModel: (capability === 'vision' ? ai.appVisionModel : ai.appTextModel) || ai.userOpenaiTextModel,
    imageModel: ai.appImageEnabled ? ai.appImageModel || ai.userOpenaiImageModel : undefined,
    baseUrl: ai.appProvider === 'openai-compatible' ? ai.appBaseUrl : undefined,
    transcribeModel: ai.transcribeModel,
    compatible: ai.appProvider === 'openai-compatible',
  });
}

function quotaGroupFor(capability: Capability, group?: QuotaGroup): QuotaGroup {
  return group ?? (capability === 'vision' ? 'vision' : capability === 'image' ? 'image' : 'text');
}

async function usedToday(userId: string, group: QuotaGroup): Promise<number> {
  const admin = createAdminClient();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('key_source', 'app')
    .like('action', `${group}:%`)
    .gte('created_at', since.toISOString());
  return count ?? 0;
}

export async function capabilityStatus(userId: string, capability: Capability, group?: QuotaGroup): Promise<CapabilityStatus> {
  const keys = await loadUserKeys(userId);
  for (const row of keys) {
    if ((capability === 'image' || capability === 'audio') && row.provider !== 'openai') continue;
    // Senza APP_ENCRYPTION_KEY la chiave non e' usabile e non si ripiega sul servizio base: stato coerente = non disponibile.
    if (!env().encryptionKey) return { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };
    // Disponibile solo se la chiave si decifra davvero (chiave corrente o precedente).
    try {
      decryptWithKeys(
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
        loadEncryptionKey(env().encryptionKey),
        loadPreviousEncryptionKey(env().encryptionKeyPrevious),
        keyAad(userId, row.provider),
      );
    } catch (e) {
      if (!(e instanceof SecretDecryptionError)) throw e;
      console.error(`[ai] stored ${row.provider} key for user ${userId} cannot be decrypted: re-entry needed`);
      return { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };
    }
    return { available: true, keySource: 'user', providerName: row.provider === 'anthropic' ? 'Anthropic' : 'OpenAI', remainingToday: null, dailyLimit: null };
  }
  const app = appProvider(capability);
  if (!app) return { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };
  const g = quotaGroupFor(capability, group);
  const limit = env().ai.limits[g];
  const used = await usedToday(userId, g).catch(() => limit);
  return { available: used < limit, keySource: 'app', providerName: app.label, remainingToday: Math.max(0, limit - used), dailyLimit: limit };
}

export async function resolveProvider(userId: string, capability: Capability, group: QuotaGroup | undefined, action: string, quantity = 1): Promise<ResolvedProvider> {
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError('quantity must be a positive integer');
  const keys = await loadUserKeys(userId);
  const usable = capability === 'image' || capability === 'audio' ? keys.filter((k) => k.provider === 'openai') : keys;
  for (const row of usable) {
    const p = await userProviderFor(row, userId, capability);
    if (p) return { provider: p, keySource: 'user', providerName: p.label };
  }
  const app = appProvider(capability);
  if (!app) throw new AiError('not_configured');
  const g = quotaGroupFor(capability, group);
  // Conteggio e registrazione sono atomici (funzione SQL con lock per utente):
  // la quota viene consumata prima della chiamata AI, non dopo.
  // Solo service role: l'RPC non e' eseguibile dai client (il limite non e' falsificabile).
  const { data: allowed, error } = await createAdminClient().rpc('consume_ai_quota', {
    p_user_id: userId,
    p_group: g,
    p_limit: env().ai.limits[g],
    p_action: action,
    p_provider: app.id,
    // Inviato solo se > 1: per 1 unita' il contratto RPC resta quello storico.
    ...(quantity > 1 ? { p_qty: quantity } : {}),
  });
  if (error) throw error;
  if (!allowed) throw new AiError('quota_exceeded');
  return { provider: app, keySource: 'app', providerName: app.label, quantity };
}

export async function recordUsage(userId: string, group: QuotaGroup, action: string, resolved: ResolvedProvider) {
  // L'uso con la chiave dell'app e' gia' registrato da consume_ai_quota.
  if (resolved.keySource === 'app') return;
  const admin = createAdminClient();
  await admin.from('ai_usage').insert({ user_id: userId, action: `${group}:${action}`, provider: resolved.provider.id, key_source: resolved.keySource });
}
