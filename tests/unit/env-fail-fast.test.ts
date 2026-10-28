import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { env, cronSecret, assertCronSecret, ConfigError } from '@/lib/env';

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
  for (const k of [...Object.keys(prod), 'AI_APP_BASE_URL']) vi.stubEnv(k, '');
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
  it('assertCronSecret: rifiuta CRON_SECRET mancante in produzione', () => {
    setEnv({ ...prod, CRON_SECRET: undefined });
    expect(() => assertCronSecret(process.env)).toThrow(/CRON_SECRET/);
  });
  it('assertCronSecret: rifiuta CRON_SECRET corto senza stamparne il valore', () => {
    setEnv({ ...prod, CRON_SECRET: 'segreto-corto' });
    expect(() => assertCronSecret(process.env)).toThrow(/at least 16/);
    try {
      assertCronSecret(process.env);
    } catch (err) {
      expect((err as Error).message).not.toContain('segreto-corto');
    }
  });
  it('assertCronSecret: accetta un segreto valido in produzione', () => {
    setEnv(prod);
    expect(() => assertCronSecret(process.env)).not.toThrow();
  });
  it('assertCronSecret: in sviluppo e durante il build non richiede nulla', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(() => assertCronSecret(process.env)).not.toThrow();
    setEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' });
    expect(() => assertCronSecret(process.env)).not.toThrow();
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

  describe('AI_APP_BASE_URL', () => {
    it('accetta https', () => {
      setEnv({ ...prod, AI_APP_BASE_URL: 'https://api.example.com/v1' });
      expect(() => env()).not.toThrow();
    });
    it('rifiuta http remoto', () => {
      setEnv({ ...prod, AI_APP_BASE_URL: 'http://api.example.com/v1' });
      expect(() => env()).toThrow(/AI_APP_BASE_URL/);
    });
    it('rifiuta http localhost in produzione', () => {
      setEnv({ ...prod, AI_APP_BASE_URL: 'http://localhost:11434/v1' });
      expect(() => env()).toThrow(ConfigError);
    });
    it('accetta http localhost fuori produzione', () => {
      setEnv({ ...prod, NODE_ENV: 'development', AI_APP_BASE_URL: 'http://127.0.0.1:11434/v1' });
      expect(() => env()).not.toThrow();
    });
    it('rifiuta http remoto anche fuori produzione', () => {
      setEnv({ ...prod, NODE_ENV: 'development', AI_APP_BASE_URL: 'http://evil.example.com' });
      expect(() => env()).toThrow(ConfigError);
    });
    it('rifiuta URL non valido', () => {
      setEnv({ ...prod, AI_APP_BASE_URL: 'not a url' });
      expect(() => env()).toThrow(ConfigError);
    });
  });
});
