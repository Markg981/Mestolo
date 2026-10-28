import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { passwordSchema } from '@/lib/password';

const toml = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8');

describe('supabase/config.toml: policy password allineata all app', () => {
  it('minimum_password_length coincide con il minimo di passwordSchema', () => {
    const m = /^minimum_password_length\s*=\s*(\d+)/m.exec(toml);
    expect(m).not.toBeNull();
    const min = Number(m![1]);
    expect(passwordSchema.safeParse('a'.repeat(min)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(min - 1)).success).toBe(false);
  });

  it('non impone requisiti di complessita che l app non ha', () => {
    expect(/^password_requirements\s*=\s*""/m.test(toml)).toBe(true);
  });

  it('le sezioni TOML principali sono ben formate', () => {
    for (const line of toml.split(/\r?\n/)) {
      if (/^\s*(#|$)/.test(line)) continue;
      expect(line).toMatch(/^(\[\[?[\w.-]+\]?\]|[\w.-]+\s*=\s*.+)$|^\s+["\w\]]/);
    }
  });
});
