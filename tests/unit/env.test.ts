import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, env, isSupabaseConfigured } from '@/lib/env';

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PHASE',
];

function clear() {
  for (const k of KEYS) vi.stubEnv(k, '');
}

afterEach(() => vi.unstubAllEnvs());

describe('env()', () => {
  it('uses dev defaults outside production', () => {
    clear();
    vi.stubEnv('NODE_ENV', 'development');
    expect(env().siteUrl).toBe('http://localhost:3000');
    expect(env().supabaseUrl).toBe('');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('throws in production listing the missing variables', () => {
    clear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    expect(() => env()).toThrow(ConfigError);
    expect(() => env()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY.*SUPABASE_SERVICE_ROLE_KEY.*NEXT_PUBLIC_SITE_URL/);
  });

  it('does not throw during next build', () => {
    clear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    expect(() => env()).not.toThrow();
  });

  it('works in production when all variables are set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'a');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.com/');
    expect(env().siteUrl).toBe('https://app.example.com');
  });
});
