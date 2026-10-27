import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));

import { GET } from '@/app/auth/callback/route';
import type { NextRequest } from 'next/server';

const req = (qs: string) => ({ nextUrl: new URL(`https://mestolo.test/auth/callback${qs}`) }) as unknown as NextRequest;
const location = (res: Response) => res.headers.get('location');

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    exchangeCodeForSession.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
  });

  it('exchanges a PKCE code and redirects to the sanitised next path', async () => {
    const res = await GET(req('?code=abc&next=/recipes/1%3Fa%3Db'));
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(location(res)).toBe('https://mestolo.test/recipes/1?a=b');
  });

  it('defaults to / when next is missing', async () => {
    expect(location(await GET(req('?code=abc')))).toBe('https://mestolo.test/');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/%2f%2fevil.com', '/%252f%252fevil.com', 'javascript:alert(1)'])(
    'never redirects off-origin for next=%s',
    async (next) => {
      const res = await GET(req(`?code=abc&next=${encodeURIComponent(next)}`));
      expect(location(res)).toBe('https://mestolo.test/');
    },
  );

  it('verifies token_hash + type when there is no code', async () => {
    const res = await GET(req('?token_hash=h&type=recovery&next=/reset-password'));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'recovery' });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(location(res)).toBe('https://mestolo.test/reset-password');
  });

  it('prefers the code over token_hash', async () => {
    await GET(req('?code=c&token_hash=h&type=signup'));
    expect(exchangeCodeForSession).toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('goes to /login?error=link when the code exchange fails, ignoring next', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad' } });
    expect(location(await GET(req('?code=abc&next=/secret')))).toBe('https://mestolo.test/login?error=link');
  });

  it('goes to /login?error=link when the OTP verification fails', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
    expect(location(await GET(req('?token_hash=h&type=signup')))).toBe('https://mestolo.test/login?error=link');
  });

  it.each(['', '?token_hash=h', '?type=signup', '?next=/x'])('does not authenticate anything for %j', async (qs) => {
    expect(location(await GET(req(qs)))).toBe('https://mestolo.test/login?error=link');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
