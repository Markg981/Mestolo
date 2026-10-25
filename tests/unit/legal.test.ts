import { afterEach, describe, expect, it, vi } from 'vitest';
import { legalConfig, missingLegalFields } from '@/lib/legal';

const VARS = [
  'NEXT_PUBLIC_LEGAL_NAME',
  'NEXT_PUBLIC_LEGAL_ADDRESS',
  'NEXT_PUBLIC_LEGAL_EMAIL',
  'NEXT_PUBLIC_SUPPORT_EMAIL',
  'NEXT_PUBLIC_LEGAL_DATA_REGION',
  'NEXT_PUBLIC_LEGAL_SENTRY_REGION',
];

describe('legal config', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports every required field as missing when nothing is set (no placeholders invented)', () => {
    for (const v of VARS) vi.stubEnv(v, '');
    const cfg = legalConfig();
    expect(cfg.name).toBeNull();
    expect(missingLegalFields(cfg)).toEqual(['name', 'address', 'email', 'dataRegion', 'sentryRegion']);
  });

  it('is complete when configured, falling back to the support email', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGAL_NAME', 'Titolare Srl');
    vi.stubEnv('NEXT_PUBLIC_LEGAL_ADDRESS', 'Via Esempio 1');
    vi.stubEnv('NEXT_PUBLIC_LEGAL_EMAIL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'privacy@example.com');
    vi.stubEnv('NEXT_PUBLIC_LEGAL_DATA_REGION', 'UE');
    vi.stubEnv('NEXT_PUBLIC_LEGAL_SENTRY_REGION', 'UE');
    expect(missingLegalFields()).toEqual([]);
    expect(legalConfig().email).toBe('privacy@example.com');
  });
});
