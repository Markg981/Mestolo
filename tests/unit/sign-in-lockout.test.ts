import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { signInWithPassword: vi.fn() };
const counts = new Map<string, number>();
let currentIp: string | null = 'ip-victim';
const MAX: Record<string, number> = { login_ip: 20, login_email: 30, login_email_ip: 8 };

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
  clientIpHash: async () => currentIp ?? 'unknown',
  clientIpHashOrNull: async () => currentIp,
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

  const fails = () => auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });

  it('dopo 30 tentativi per email da IP diversi il successivo e bloccato PRIMA di interrogare Supabase', async () => {
    fails();
    for (let i = 0; i < 30; i++) {
      currentIp = `ip-attacker-${i}`;
      expect(await signIn(undefined, form('wrongpassword'))).toMatchObject({ error: 'auth_invalid' });
    }
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(30);
    currentIp = 'ip-attacker-new';
    expect(await signIn(undefined, form('wrongpassword'))).toMatchObject({ error: 'rate_limited' });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(30);
  });

  it('IP sconosciuto: nessun bucket condiviso, altre email non sono bloccate', async () => {
    fails();
    currentIp = null;
    for (let i = 0; i < 25; i++) {
      const f = form('wrongpassword');
      f.set('email', `user${i}@example.com`);
      expect(await signIn(undefined, f)).toMatchObject({ error: 'auth_invalid' });
    }
    expect([...counts.keys()].some((k) => k.startsWith('login_ip:') || k.includes('unknown'))).toBe(false);
  });

  it('IP sconosciuto: il limite per email resta attivo', async () => {
    fails();
    currentIp = null;
    for (let i = 0; i < 30; i++) await signIn(undefined, form('wrongpassword'));
    expect(await signIn(undefined, form('wrongpassword'))).toMatchObject({ error: 'rate_limited' });
  });
});

describe('signIn: nessuna enumerazione degli account (A-08)', () => {
  beforeEach(() => {
    counts.clear();
    vi.clearAllMocks();
    currentIp = 'ip-a08';
  });

  it('credenziali errate e account non confermato restituiscono lo stesso errore', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Invalid login credentials' } });
    const wrong = await signIn(undefined, form('wrongpassword'));
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Email not confirmed' } });
    const unconfirmed = await signIn(undefined, form('wrongpassword'));
    expect(unconfirmed).toEqual(wrong);
    expect(unconfirmed).toMatchObject({ error: 'auth_invalid' });
  });
});
