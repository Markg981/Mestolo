import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};
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

import { changePassword } from '@/app/actions/auth';
import { passwordSchema } from '@/lib/password';
import { RateLimitedError } from '@/lib/rate-limit';

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const valid = { current: 'oldpassword', password: 'newpassword1', confirm: 'newpassword1' };

describe('passwordSchema', () => {
  it('requires 8 to 200 characters', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'Ada@Example.com' } } });
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    enforceRateLimit.mockResolvedValue(undefined);
  });

  it('verifies the current password, then updates', async () => {
    expect(await changePassword(undefined, form(valid))).toEqual({ sent: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'Ada@Example.com', password: 'oldpassword' });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword1' });
  });
  it('signs out other sessions after the update', async () => {
    await changePassword(undefined, form(valid));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });
  it('does not fail when signOut others errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.signOut.mockResolvedValue({ error: { message: 'x' } });
    expect(await changePassword(undefined, form(valid))).toEqual({ sent: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not sign out others when the update fails', async () => {
    auth.updateUser.mockResolvedValue({ error: { message: 'boom' } });
    await changePassword(undefined, form(valid));
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it('rejects a weak new password without touching auth', async () => {
    const res = await changePassword(undefined, form({ ...valid, password: 'short', confirm: 'short' }));
    expect(res).toEqual({ error: 'auth_weak_password' });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it('rejects a mismatched confirmation', async () => {
    const res = await changePassword(undefined, form({ ...valid, confirm: 'different123' }));
    expect(res).toEqual({ error: 'invalid_input' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('does not update when the current password is wrong', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    expect(await changePassword(undefined, form(valid))).toEqual({ error: 'auth_wrong_password' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('uses a user-id bucket distinct from the signIn login_email bucket', async () => {
    enforceRateLimit.mockRejectedValue(new RateLimitedError('password_verify'));
    expect(await changePassword(undefined, form(valid))).toEqual({ error: 'rate_limited' });
    expect(enforceRateLimit).toHaveBeenCalledWith('password_verify', 'u1');
    expect(enforceRateLimit).not.toHaveBeenCalledWith('login_email', expect.anything());
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it('requires a signed-in user', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await changePassword(undefined, form(valid))).toEqual({ error: 'forbidden' });
  });
  it('maps update failures', async () => {
    auth.updateUser.mockResolvedValue({ error: { message: 'boom' } });
    expect(await changePassword(undefined, form(valid))).toEqual({ error: 'generic' });
  });
});
