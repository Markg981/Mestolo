import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const resetPasswordForEmail = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { resetPasswordForEmail } }) }));
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('@/lib/env', () => ({ env: () => ({ siteUrl: 'http://x' }) }));

import { requestPasswordReset } from '@/app/actions/auth';
import { LIMITS, hashKey } from '@/lib/rate-limit';

const form = (email: string) => {
  const f = new FormData();
  f.set('email', email);
  return f;
};

describe('requestPasswordReset: limite per email', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  });

  it('definisce reset_email a 3 richieste/ora', () => {
    expect(LIMITS.reset_email).toEqual([3, 3600]);
  });

  it('applica il bucket per email (normalizzata) oltre a quello per IP', async () => {
    const r = await requestPasswordReset(undefined, form('Mario@Example.com'));
    expect(r).toMatchObject({ sent: true });
    const buckets = rpc.mock.calls.map((c) => c[1].p_bucket as string);
    expect(buckets).toContain(`reset_email:${hashKey('mario@example.com')}`);
    expect(buckets.some((b) => b.startsWith('reset_ip:'))).toBe(true);
  });

  it('oltre il limite per email risponde rate_limited senza inviare la mail', async () => {
    rpc.mockImplementation(async (_: string, a: { p_bucket: string }) => ({ data: !a.p_bucket.startsWith('reset_email:'), error: null }));
    const r = await requestPasswordReset(undefined, form('a@b.it'));
    expect(r).toEqual({ error: 'rate_limited' });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('fail-closed se il limiter non e disponibile', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await requestPasswordReset(undefined, form('a@b.it'));
    expect(r).toEqual({ error: 'rate_limited' });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
