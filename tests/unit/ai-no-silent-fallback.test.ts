import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  encryptionKey: undefined as string | undefined,
  previousKey: undefined as string | undefined,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: async () => state.result }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async () => ({ data: true, error: null }) }) }));
vi.mock('@/lib/env', () => ({
  ConfigError: class ConfigError extends Error {},
  env: () => ({
    encryptionKey: state.encryptionKey,
    encryptionKeyPrevious: state.previousKey,
    ai: { appProvider: 'openai', appApiKey: 'sk-app-key-1234567890', limits: { text: 5, vision: 5, image: 5, translate: 5 }, userAnthropicModel: 'm', userOpenaiTextModel: 'm', userOpenaiImageModel: 'm', transcribeModel: 'm' },
  }),
}));

import { capabilityStatus, resolveProvider } from '@/lib/ai/service';
import { AiError } from '@/lib/ai/providers';
import { EncryptionConfigError, encryptSecret, keyAad } from '@/lib/crypto/secrets';
import { toFailure } from '@/app/actions/_utils';

const row = { provider: 'openai', ciphertext: 'x', iv: 'y', auth_tag: 'z' };

describe('no silent fallback to the base service', () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.encryptionKey = undefined;
    state.previousKey = undefined;
    state.rpcCalls = [];
  });

  it('fails explicitly when reading the user keys errors out', async () => {
    state.result = { data: null, error: { message: 'boom' } };
    await expect(resolveProvider('u1', 'text', 'text', 'a')).rejects.toMatchObject({ code: 'keys_unavailable' });
    await expect(capabilityStatus('u1', 'text', 'text')).rejects.toBeInstanceOf(AiError);
    expect(toFailure(new AiError('keys_unavailable'), 't')).toMatchObject({ error: 'ai_keys_unavailable' });
  });

  it('fails explicitly when a user key exists but APP_ENCRYPTION_KEY is missing', async () => {
    state.result = { data: [row], error: null };
    await expect(resolveProvider('u1', 'text', 'text', 'a')).rejects.toBeInstanceOf(EncryptionConfigError);
  });

  it('reports "not available" instead of "uses your key" when the key cannot be used', async () => {
    state.result = { data: [row], error: null };
    await expect(capabilityStatus('u1', 'text', 'text')).resolves.toMatchObject({ available: false, keySource: null });
  });

  it('reports an undecryptable key as unavailable (no crash)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.encryptionKey = randomBytes(32).toString('base64');
    state.result = { data: [row], error: null };
    await expect(capabilityStatus('u1', 'text', 'text')).resolves.toMatchObject({ available: false, keySource: null });
  });

  it('reports available when the key was encrypted with the previous key', async () => {
    const oldKey = randomBytes(32);
    const e = encryptSecret('sk-user-key', oldKey, keyAad('u1', 'openai'));
    state.encryptionKey = randomBytes(32).toString('base64');
    state.previousKey = oldKey.toString('base64');
    state.result = { data: [{ provider: 'openai', ciphertext: e.ciphertext, iv: e.iv, auth_tag: e.authTag }], error: null };
    await expect(capabilityStatus('u1', 'text', 'text')).resolves.toMatchObject({ available: true, keySource: 'user' });
  });

  it('still uses the base service when the user has no key', async () => {
    const r = await resolveProvider('u1', 'text', 'text', 'a');
    expect(r.keySource).toBe('app');
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toMatchObject({ name: 'consume_ai_quota', args: { p_user_id: 'u1' } });
  });
});
