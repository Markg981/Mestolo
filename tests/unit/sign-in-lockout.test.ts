import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { signInWithPassword: vi.fn() };
const counts = new Map<string, number>();
let currentIp = 'ip-victim';
const MAX: Record<string, number> = { login_ip: 20, login_email: 60, login_email_ip: 8 };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth, rpc: () => ({ maybeSingle: async () => ({ data: { locale: 'it' } }) }) }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }), headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  clientIpHash: async () => currentIp,
  hashKey: (s: string) => `h:${s}`,
  enforceAuthRateLimit: async (limit: string, subject: string) => {
    const k = `${limit}:${subject}`;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > MAX[limit]) throw new Error('rate_limited');
  },
}));

import { signIn } from '@/app/actions/auth';

function form(password: string) {
  const f = new FormData();
  f.set('email', 'victim@example.com');
  f.set('password', password);
  return f;
}

describe('signIn lockout', () => {
  beforeEach(() => {
    counts.clear();
    vi.clearAllMocks();
  });

  it('60 failed attempts from other IPs do not block the victim from logging in', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
    for (let i = 0; i < 60; i++) {
      currentIp = `ip-attacker-${i}`;
      expect(await signIn(undefined, form('wrongpassword'))).toMatchObject({ error: 'auth_invalid' });
    }
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    currentIp = 'ip-victim';
    await expect(signIn(undefined, form('correctpassword'))).rejects.toThrow('NEXT_REDIRECT');
  });
});
