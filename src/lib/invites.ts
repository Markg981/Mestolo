import { createHash, randomBytes } from 'node:crypto';

/**
 * Token degli inviti: 32 byte casuali in base64url (43 caratteri). Nel database
 * c'e' solo l'hash sha256 in esadecimale, lo stesso calcolato da accept_invite.
 */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isPlausibleInviteToken(token: unknown): token is string {
  return typeof token === 'string' && INVITE_TOKEN_RE.test(token);
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function inviteUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/invite/${token}`;
}
