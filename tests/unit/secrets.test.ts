import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, keyAad, keyHint, loadEncryptionKey, redactSecrets, EncryptionConfigError } from '@/lib/crypto/secrets';

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
