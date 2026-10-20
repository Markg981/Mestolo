import { describe, expect, it } from 'vitest';
import { generateInviteToken, hashInviteToken, inviteUrl, isPlausibleInviteToken } from '@/lib/invites';
import { redactText, scrubEvent } from '@/lib/monitoring/scrub';

describe('token degli inviti', () => {
  it('genera token url-safe da 256 bit, tutti diversi', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInviteToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isPlausibleInviteToken(t)).toBe(true);
    }
  });

  it('rifiuta forme non plausibili', () => {
    for (const bad of ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}/`, `${'a'.repeat(42)} `, null, undefined, 42]) {
      expect(isPlausibleInviteToken(bad)).toBe(false);
    }
  });

  it('l\'hash e\' sha256 esadecimale deterministico (come in accept_invite)', () => {
    expect(hashInviteToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
    expect(hashInviteToken(generateInviteToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compone l\'URL senza doppie barre', () => {
    expect(inviteUrl('https://mestolo.app/', 'tok')).toBe('https://mestolo.app/invite/tok');
  });
});

describe('scrub dei token di invito', () => {
  const token = generateInviteToken();

  it('oscura il token nei testi e negli URL', () => {
    expect(redactText(`GET https://mestolo.app/invite/${token}`)).not.toContain(token);
    expect(redactText(`/invite/${token}`)).toContain('/invite/[token]');
  });

  it('oscura il token negli eventi Sentry', () => {
    const s = JSON.stringify(
      scrubEvent({
        transaction: `/invite/${token}`,
        request: { url: `https://mestolo.app/invite/${token}` },
        breadcrumbs: [{ category: 'navigation', data: { to: `/invite/${token}` } }],
      }),
    );
    expect(s).not.toContain(token);
  });
});
