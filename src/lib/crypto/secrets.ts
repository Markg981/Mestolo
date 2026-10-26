import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for users' personal API keys.
 * The 32-byte key comes from APP_ENCRYPTION_KEY (managed outside the DB).
 * The additional authenticated data binds a ciphertext to its user+provider,
 * so a ciphertext copied to another row cannot be decrypted.
 */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class EncryptionConfigError extends Error {
  override name = 'EncryptionConfigError';
}

/** The stored secret cannot be decrypted (wrong master key, wrong user/provider, corrupted data). */
export class SecretDecryptionError extends Error {
  override name = 'SecretDecryptionError';
}

export function loadEncryptionKey(b64: string | undefined): Buffer {
  if (!b64) throw new EncryptionConfigError('APP_ENCRYPTION_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new EncryptionConfigError('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
}

/** Optional previous key (APP_ENCRYPTION_KEY_PREVIOUS), used only as a decrypt fallback during rotation. */
export function loadPreviousEncryptionKey(b64: string | undefined): Buffer | null {
  if (!b64 || !b64.trim()) return null;
  const key = Buffer.from(b64.trim(), 'base64');
  if (key.length !== 32) throw new EncryptionConfigError('APP_ENCRYPTION_KEY_PREVIOUS must be 32 bytes (base64)');
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer, aad: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer, aad: string): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Never forward the original message: keep the error free of any key material.
    throw new SecretDecryptionError('Unable to decrypt the stored secret');
  }
}

/**
 * Tries the current key first, then the previous one (rotation). `usedPrevious` tells the
 * caller the ciphertext is still under the old key and should be re-encrypted.
 * Legacy ciphertexts (same format, single key) decrypt unchanged with the current key.
 */
export function decryptWithKeys(
  secret: EncryptedSecret,
  current: Buffer,
  previous: Buffer | null,
  aad: string,
): { plaintext: string; usedPrevious: boolean } {
  try {
    return { plaintext: decryptSecret(secret, current, aad), usedPrevious: false };
  } catch (e) {
    if (!previous) throw e;
    return { plaintext: decryptSecret(secret, previous, aad), usedPrevious: true };
  }
}

export function keyAad(userId: string, provider: string): string {
  return `mestolo:api-key:${userId}:${provider}`;
}

/** Last 4 characters only, for display ("…a1b2"). */
export function keyHint(plaintext: string): string {
  const t = plaintext.trim();
  return `…${t.slice(-4)}`;
}

// Re-exported so existing callers keep working; the pure implementation lives in
// ./redact (no node:crypto) so it can be bundled for the browser and Edge.
export { redactSecrets } from './redact';
