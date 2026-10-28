import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({ data: [] as unknown[], encryptionKey: undefined as string | undefined }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: state.data, error: null }) }) }) }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async () => ({ data: true, error: null }) }) }));
vi.mock('@/lib/env', () => ({
  ConfigError: class ConfigError extends Error {},
  env: () => ({
    encryptionKey: state.encryptionKey,
    encryptionKeyPrevious: undefined,
    ai: { appProvider: undefined, appApiKey: undefined, limits: { text: 5, vision: 5, image: 5, translate: 5 }, userAnthropicModel: 'm', userOpenaiTextModel: 'm', userOpenaiImageModel: 'm', transcribeModel: 'm' },
  }),
}));

import { capabilityStatus } from '@/lib/ai/service';
import { encryptSecret, keyAad } from '@/lib/crypto/secrets';

describe('scelta deterministica tra due chiavi utente (C-09)', () => {
  beforeEach(() => {
    const key = randomBytes(32).toString('base64');
    state.encryptionKey = key;
    const mk = (provider: string) => {
      const e = encryptSecret('sk-test-' + provider, Buffer.from(key, 'base64'), keyAad('u1', provider));
      return { provider, ciphertext: e.ciphertext, iv: e.iv, auth_tag: e.authTag };
    };
    state.data = [mk('anthropic'), mk('openai')];
  });

  it('usa sempre OpenAI indipendentemente dall ordine restituito dalla query', async () => {
    const a = await capabilityStatus('u1', 'text', 'text');
    state.data = [...state.data].reverse();
    const b = await capabilityStatus('u1', 'text', 'text');
    expect(a.providerName).toBe('OpenAI');
    expect(b.providerName).toBe('OpenAI');
  });
});
