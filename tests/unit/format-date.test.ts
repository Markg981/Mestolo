import { describe, expect, it } from 'vitest';
import { formatDateUtc } from '@/lib/format-date';

describe('formatDateUtc', () => {
  it('usa il giorno UTC indipendentemente dal fuso orario del processo', () => {
    const iso = '2026-03-10T23:30:00Z';
    const original = process.env.TZ;
    const out: string[] = [];
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz;
      out.push(formatDateUtc(iso, 'en'));
    }
    process.env.TZ = original;
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toContain('10');
  });
});
