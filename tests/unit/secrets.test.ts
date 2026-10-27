import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, decryptWithKeys, loadPreviousEncryptionKey, SecretDecryptionError, encryptSecret, keyAad, keyHint, loadEncryptionKey, redactSecrets, EncryptionConfigError } from '@/lib/crypto/secrets';

describe('API key encryption', () => {
  const key = randomBytes(32);
  const secret = 'sk-test-1234567890abcdefXYZ9';

  it('round-trips and never stores the plaintext', () => {
    const enc = encryptSecret(secret, key, keyAad('u1', 'openai'));
    expect(JSON.stringify(enc)).not.toContain(secret);
    expect(decryptSecret(enc, key, keyAad('u1', 'openai'))).toBe(secret);
  });
  it('uses a fresh IV each time', () => {
    const a = encryptSecret(secret, key, 'x');
    const b = encryptSecret(secret, key, 'x');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it('fails if the ciphertext is moved to another user or provider', () => {
    const enc = encryptSecret(secret, key, keyAad('u1', 'openai'));
    expect(() => decryptSecret(enc, key, keyAad('u2', 'openai'))).toThrow();
    expect(() => decryptSecret(enc, key, keyAad('u1', 'anthropic'))).toThrow();
  });
  it('fails with a different master key or tampered data', () => {
    const enc = encryptSecret(secret, key, 'x');
    expect(() => decryptSecret(enc, randomBytes(32), 'x')).toThrow();
    const tampered = { ...enc, ciphertext: Buffer.from('AAAA' + enc.ciphertext.slice(4), 'utf8').toString() };
    expect(() => decryptSecret(tampered, key, 'x')).toThrow();
  });
  it('validates the master key', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(EncryptionConfigError);
    expect(() => loadEncryptionKey(Buffer.from('short').toString('base64'))).toThrow(EncryptionConfigError);
    expect(loadEncryptionKey(key.toString('base64'))).toHaveLength(32);
  });
  it('shows only a hint and redacts keys from strings', () => {
    expect(keyHint(secret)).toBe('…XYZ9');
    expect(redactSecrets(`Bearer error for key ${secret}`)).not.toContain(secret);
    expect(redactSecrets('{"x-api-key": "sk-ant-api03-abcdefghijklmnop"}')).not.toContain('abcdefghijklmnop');
  });
});

describe('hardening GCM e chiave previous', () => {
  const key = randomBytes(32);
  it('rifiuta IV e tag di lunghezza errata', () => {
    const enc = encryptSecret('sk-abc', key, 'x');
    expect(() => decryptSecret({ ...enc, iv: randomBytes(16).toString('base64') }, key, 'x')).toThrow(SecretDecryptionError);
    expect(() => decryptSecret({ ...enc, authTag: randomBytes(4).toString('base64') }, key, 'x')).toThrow(SecretDecryptionError);
    expect(decryptSecret(enc, key, 'x')).toBe('sk-abc');
  });
  it('una chiave previous malformata viene ignorata e la corrente decifra', () => {
    const prev = loadPreviousEncryptionKey('troppo-corta');
    expect(prev).toBeNull();
    const enc = encryptSecret('sk-abc', key, 'x');
    expect(decryptWithKeys(enc, key, prev, 'x').plaintext).toBe('sk-abc');
  });
  it('assertProductionEnv valida APP_ENCRYPTION_KEY_PREVIOUS', async () => {
    const { assertProductionEnv } = await import('@/lib/env');
    const base = {
      NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'u', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's', NEXT_PUBLIC_SITE_URL: 'h', APP_ENCRYPTION_KEY: key.toString('base64'),
    } as unknown as NodeJS.ProcessEnv;
    expect(() => assertProductionEnv(base)).not.toThrow();
    expect(() => assertProductionEnv({ ...base, APP_ENCRYPTION_KEY_PREVIOUS: 'corta' })).toThrow(/PREVIOUS/);
  });
});
