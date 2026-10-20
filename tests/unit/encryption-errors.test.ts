import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, loadEncryptionKey, EncryptionConfigError, SecretDecryptionError } from '@/lib/crypto/secrets';
import { toFailure } from '@/app/actions/_utils';

describe('encryption error handling', () => {
  afterEach(() => vi.restoreAllMocks());
  const key = randomBytes(32);
  const enc = encryptSecret('sk-test-1234567890abcdefXYZ9', key, 'x');

  it('reports a dedicated error name for config problems', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(expect.objectContaining({ name: 'EncryptionConfigError' }));
    expect(new EncryptionConfigError('x').name).toBe('EncryptionConfigError');
  });
  it('wraps wrong key and corrupted ciphertext in SecretDecryptionError', () => {
    expect(() => decryptSecret(enc, randomBytes(32), 'x')).toThrow(SecretDecryptionError);
    expect(() => decryptSecret({ ...enc, ciphertext: 'AAAA' + enc.ciphertext.slice(4) }, key, 'x')).toThrow(SecretDecryptionError);
    expect(() => decryptSecret({ ...enc, authTag: '!!' }, key, 'x')).toThrow(SecretDecryptionError);
  });
  it('maps decryption failures to ai_invalid_key and logs', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let err: unknown;
    try { decryptSecret(enc, randomBytes(32), 'x'); } catch (e) { err = e; }
    expect(toFailure(err, 'test')).toMatchObject({ ok: false, error: 'ai_invalid_key' });
    expect(log).toHaveBeenCalledOnce();
  });
  it('maps encryption config errors to config', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let err: unknown;
    try { loadEncryptionKey(undefined); } catch (e) { err = e; }
    expect(toFailure(err, 'test')).toMatchObject({ ok: false, error: 'config' });
  });
});
