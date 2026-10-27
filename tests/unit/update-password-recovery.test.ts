import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { getClaims: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() };
const enforceRateLimit = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }), headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  RateLimitedError: class RateLimitedError extends Error {},
  clientIpHash: async () => 'ip',
  hashKey: (s: string) => `h:${s}`,
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
  enforceAuthRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
}));

import { updatePassword } from '@/app/actions/auth';
import { isRecoverySession } from '@/lib/recovery-session';

const now = () => Math.floor(Date.now() / 1000);
function form() {
  const f = new FormData();
  f.set('password', 'newpassword1');
  f.set('confirm', 'newpassword1');
  return f;
}

describe('isRecoverySession', () => {
  it('accetta otp recente, rifiuta password, otp vecchio o assente', () => {
    expect(isRecoverySession({ amr: [{ method: 'otp', timestamp: now() - 60 }] })).toBe(true);
    expect(isRecoverySession({ amr: [{ method: 'password', timestamp: now() - 60 }] })).toBe(false);
    expect(isRecoverySession({ amr: [{ method: 'otp', timestamp: now() - 3600 }] })).toBe(false);
    expect(isRecoverySession({ amr: [{ method: 'otp', timestamp: now() - 3600 }, { method: 'password', timestamp: now() }] })).toBe(false);
    expect(isRecoverySession({})).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
  });
});

describe('updatePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    enforceRateLimit.mockResolvedValue(undefined);
  });

  it('rifiuta una sessione normale', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', amr: [{ method: 'password', timestamp: now() }] } } });
    expect(await updatePassword(undefined, form())).toEqual({ error: 'forbidden' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('rifiuta senza sessione', async () => {
    auth.getClaims.mockResolvedValue({ data: null });
    expect(await updatePassword(undefined, form())).toEqual({ error: 'forbidden' });
  });

  it('accetta una sessione di recovery', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', amr: [{ method: 'otp', timestamp: now() }] } } });
    await updatePassword(undefined, form());
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword1' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('applica il rate limit', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', amr: [{ method: 'otp', timestamp: now() }] } } });
    enforceRateLimit.mockRejectedValue(new Error('x'));
    expect(await updatePassword(undefined, form())).toEqual({ error: 'rate_limited' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
