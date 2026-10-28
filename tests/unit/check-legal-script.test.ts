import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(extra: Record<string, string>) {
  const env = {
    PATH: process.env.PATH ?? '',
    LEGAL_STRICT: '1',
    NEXT_PUBLIC_LEGAL_NAME: 'x',
    NEXT_PUBLIC_LEGAL_ADDRESS: 'x',
    NEXT_PUBLIC_LEGAL_EMAIL: 'x@example.com',
    NEXT_PUBLIC_LEGAL_DATA_REGION: 'x',
    ...extra,
  };
  const r = spawnSync(process.execPath, ['scripts/check-legal.mjs'], { env: env as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  return { code: r.status, err: r.stderr };
}

describe('check-legal.mjs e regione Sentry', () => {
  it('senza Sentry non richiede la regione', () => {
    expect(run({}).code).toBe(0);
  });
  it('con DSN Sentry richiede la regione', () => {
    const r = run({ SENTRY_DSN: 'https://k@example.invalid/1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('NEXT_PUBLIC_LEGAL_SENTRY_REGION');
  });
  it('con DSN pubblico e regione impostata passa', () => {
    expect(run({ NEXT_PUBLIC_SENTRY_DSN: 'https://k@example.invalid/1', NEXT_PUBLIC_LEGAL_SENTRY_REGION: 'UE' }).code).toBe(0);
  });
});
