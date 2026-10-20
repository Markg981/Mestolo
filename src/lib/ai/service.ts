import 'server-only';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { decryptSecret, keyAad, loadEncryptionKey } from '@/lib/crypto/secrets';
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
  const { data } = await admin.from('user_api_keys').select('provider, ciphertext, iv, auth_tag').eq('user_id', userId);
  return (data as UserKeyRow[]) ?? [];
}

function userProviderFor(row: UserKeyRow, userId: string, capability: Capability): AiProvider | null {
  const cfg = env();
  if (!cfg.encryptionKey) return null;
  const key = loadEncryptionKey(cfg.encryptionKey);
  const apiKey = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key, keyAad(userId, row.provider));
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
  const keys = await loadUserKeys(userId).catch(() => []);
  for (const row of keys) {
    if ((capability === 'image' || capability === 'audio') && row.provider !== 'openai') continue;
    return { available: !!env().encryptionKey, keySource: 'user', providerName: row.provider === 'anthropic' ? 'Anthropic' : 'OpenAI', remainingToday: null, dailyLimit: null };
  }
  const app = appProvider(capability);
  if (!app) return { available: false, keySource: null, providerName: null, remainingToday: null, dailyLimit: null };
  const g = quotaGroupFor(capability, group);
  const limit = env().ai.limits[g];
  const used = await usedToday(userId, g).catch(() => limit);
  return { available: used < limit, keySource: 'app', providerName: app.label, remainingToday: Math.max(0, limit - used), dailyLimit: limit };
}

export async function resolveProvider(userId: string, capability: Capability, group: QuotaGroup | undefined, action: string): Promise<ResolvedProvider> {
  const keys = await loadUserKeys(userId);
  const usable = capability === 'image' || capability === 'audio' ? keys.filter((k) => k.provider === 'openai') : keys;
  for (const row of usable) {
    const p = userProviderFor(row, userId, capability);
    if (p) return { provider: p, keySource: 'user', providerName: p.label };
  }
  const app = appProvider(capability);
  if (!app) throw new AiError('not_configured');
  const g = quotaGroupFor(capability, group);
  // Conteggio e registrazione sono atomici (funzione SQL con lock per utente):
  // la quota viene consumata prima della chiamata AI, non dopo.
  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc('consume_ai_quota', {
    p_group: g,
    p_limit: env().ai.limits[g],
    p_action: action,
    p_provider: app.id,
  });
  if (error) throw error;
  if (!allowed) throw new AiError('quota_exceeded');
  return { provider: app, keySource: 'app', providerName: app.label };
}

export async function recordUsage(userId: string, group: QuotaGroup, action: string, resolved: ResolvedProvider) {
  // L'uso con la chiave dell'app e' gia' registrato da consume_ai_quota.
  if (resolved.keySource === 'app') return;
  const admin = createAdminClient();
  await admin.from('ai_usage').insert({ user_id: userId, action: `${group}:${action}`, provider: resolved.provider.id, key_source: resolved.keySource });
}
