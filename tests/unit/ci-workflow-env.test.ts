import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertProductionEnv } from '@/lib/env';

const dir = join(process.cwd(), '.github', 'workflows');

/** Valori letterali di APP_ENCRYPTION_KEY nei workflow (i riferimenti ${{ secrets.* }} sono ignorati). */
function literalKeys() {
  const out: { file: string; value: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/^\s*APP_ENCRYPTION_KEY:\s*(.+?)\s*$/gm)) {
      const value = m[1].replace(/^["']|["']$/g, '');
      if (!value.includes('${{')) out.push({ file, value });
    }
  }
  return out;
}

describe('workflow CI: APP_ENCRYPTION_KEY', () => {
  const keys = literalKeys();

  it('trova almeno una chiave fittizia (ci.yml / e2e.yml)', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(keys)('$file: la chiave e valida per assertProductionEnv', ({ value }) => {
    const e = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: 'http://x',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      NEXT_PUBLIC_SITE_URL: 'http://x',
      APP_ENCRYPTION_KEY: value,
    } as unknown as NodeJS.ProcessEnv;
    expect(() => assertProductionEnv(e)).not.toThrow();
  });
});
