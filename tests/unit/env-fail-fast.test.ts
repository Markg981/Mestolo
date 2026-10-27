import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { env, cronSecret, ConfigError } from '@/lib/env';

const KEY = Buffer.alloc(32, 1).toString('base64');
const prod: Record<string, string> = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'http://x',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
  SUPABASE_SERVICE_ROLE_KEY: 's',
  NEXT_PUBLIC_SITE_URL: 'http://x',
  APP_ENCRYPTION_KEY: KEY,
  CRON_SECRET: 'x'.repeat(32),
};

function setEnv(o: Record<string, string | undefined>) {
  for (const k of Object.keys(prod)) vi.stubEnv(k, '');
  vi.stubEnv('NEXT_PHASE', '');
  for (const [k, v] of Object.entries(o)) if (v !== undefined) vi.stubEnv(k, v);
}

describe('env fail-fast in produzione', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accetta una configurazione completa', () => {
    setEnv(prod);
    expect(() => env()).not.toThrow();
  });
  it('rifiuta APP_ENCRYPTION_KEY mancante', () => {
    setEnv({ ...prod, APP_ENCRYPTION_KEY: undefined });
    expect(() => env()).toThrow(/APP_ENCRYPTION_KEY/);
  });
  it('env() non dipende da CRON_SECRET (il login non deve rompersi)', () => {
    setEnv({ ...prod, CRON_SECRET: undefined });
    expect(() => env()).not.toThrow();
  });
  it('rifiuta APP_ENCRYPTION_KEY non da 32 byte', () => {
    setEnv({ ...prod, APP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') });
    expect(() => env()).toThrow(ConfigError);
  });
  it('cronSecret: null se mancante o troppo corto in produzione', () => {
    setEnv({ ...prod, CRON_SECRET: undefined });
    expect(cronSecret()).toBeNull();
    setEnv({ ...prod, CRON_SECRET: 'corto' });
    expect(cronSecret()).toBeNull();
    setEnv(prod);
    expect(cronSecret()).toBe('x'.repeat(32));
  });
  it('in test/dev non richiede i segreti', () => {
    setEnv({ NODE_ENV: 'test' });
    expect(() => env()).not.toThrow();
  });
  it('durante next build non richiede i segreti', () => {
    setEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' });
    expect(() => env()).not.toThrow();
  });
});
