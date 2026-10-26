import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, decryptWithKeys, encryptSecret, loadPreviousEncryptionKey, SecretDecryptionError } from '@/lib/crypto/secrets';

const aad = 'mestolo:api-key:u1:openai';

describe('encryption key rotation', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it('decrypts old-key ciphertext via the previous key', () => {
    const enc = encryptSecret('sk-old', oldKey, aad);
    expect(decryptWithKeys(enc, newKey, oldKey, aad)).toEqual({ plaintext: 'sk-old', usedPrevious: true });
  });

  it('new encryptions use the current key', () => {
    const enc = encryptSecret('sk-new', newKey, aad);
    expect(decryptSecret(enc, newKey, aad)).toBe('sk-new');
    expect(() => decryptSecret(enc, oldKey, aad)).toThrow(SecretDecryptionError);
    expect(decryptWithKeys(enc, newKey, oldKey, aad).usedPrevious).toBe(false);
  });

  it('legacy ciphertext (no previous key configured) still decrypts', () => {
    const enc = encryptSecret('sk-legacy', newKey, aad);
    expect(decryptWithKeys(enc, newKey, null, aad).plaintext).toBe('sk-legacy');
  });

  it('throws when neither key decrypts', () => {
    const enc = encryptSecret('x', randomBytes(32), aad);
    expect(() => decryptWithKeys(enc, newKey, oldKey, aad)).toThrow(SecretDecryptionError);
    expect(() => decryptWithKeys(enc, newKey, null, aad)).toThrow(SecretDecryptionError);
  });

  it('loadPreviousEncryptionKey is optional and validates length', () => {
    expect(loadPreviousEncryptionKey(undefined)).toBeNull();
    expect(loadPreviousEncryptionKey('')).toBeNull();
    expect(() => loadPreviousEncryptionKey('abcd')).toThrow();
  });
});
