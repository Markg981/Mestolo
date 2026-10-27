import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
const headersMock = vi.fn();
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

import { LIMITS, RateLimitedError, clientIpHash, enforceRateLimit, hashKey } from '@/lib/rate-limit';

describe('hashKey', () => {
  it('is deterministic, 32 hex chars and does not leak the input', () => {
    const h = hashKey('1.2.3.4');
    expect(h).toBe(hashKey('1.2.3.4'));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain('1.2.3.4');
    expect(hashKey('1.2.3.5')).not.toBe(h);
  });
});

describe('clientIpHash', () => {
  it('hashes the IP taken from the request headers', async () => {
    headersMock.mockReturnValue(new Headers({ 'x-forwarded-for': '9.9.9.9' }));
    expect(await clientIpHash()).toBe(hashKey('9.9.9.9'));
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => rpc.mockReset());

  it('passes the bucket, max and window of the named limit to the RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(enforceRateLimit('login_email', 'abc')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_bucket: 'login_email:abc',
      p_max: LIMITS.login_email[0],
      p_window_seconds: LIMITS.login_email[1],
    });
  });

  it('throws RateLimitedError carrying the limit name when the RPC denies', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const err = await enforceRateLimit('ai_text', 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.limit).toBe('ai_text');
    expect(err.message).toBe('rate_limited');
  });

  it('fails closed when the RPC errors (not a RateLimitedError)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const err = await enforceRateLimit('login_ip', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitedError);
    expect(err.message).toBe('rate_limit_unavailable');
  });

  it('fails closed when the RPC returns anything other than strictly true', async () => {
    for (const data of [null, undefined, 'true', 1]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(enforceRateLimit('report', 'u')).rejects.toBeInstanceOf(RateLimitedError);
    }
  });
});

describe('LIMITS', () => {
  it('has a positive max and window for every action', () => {
    for (const [max, win] of Object.values(LIMITS)) {
      expect(max).toBeGreaterThan(0);
      expect(win).toBeGreaterThan(0);
    }
  });
});
