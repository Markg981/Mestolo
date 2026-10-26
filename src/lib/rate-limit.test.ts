import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { LIMITS, RateLimitedError, enforceAuthRateLimit } from './rate-limit';

describe('auth rate limiting', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the email-only ceiling looser than the per-(email, IP) limit', () => {
    expect(LIMITS.login_email[0]).toBeGreaterThan(LIMITS.login_email_ip[0]);
  });

  it('passes when under the limit', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(enforceAuthRateLimit('login_ip', 'x')).resolves.toBeUndefined();
  });

  it('throws RateLimitedError when exceeded without logging', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(enforceAuthRateLimit('login_ip', 'x')).rejects.toBeInstanceOf(RateLimitedError);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('fails closed and logs when the limiter errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(enforceAuthRateLimit('login_ip', 'x')).rejects.toThrow('rate_limit_unavailable');
    expect(console.error).toHaveBeenCalled();
  });

  it('defines limits for user search and push subscriptions', () => {
    expect(LIMITS.user_search).toBeDefined();
    expect(LIMITS.push_subscribe).toBeDefined();
  });
});
