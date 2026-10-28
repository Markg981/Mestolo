import { describe, expect, it } from 'vitest';
import { isValidIsoDate, isoDateSchema } from '@/lib/plan/week';

describe('validazione date del piano', () => {
  it('accetta date reali, anche bisestili', () => {
    expect(isValidIsoDate('2026-10-28')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
  it('rifiuta date inesistenti invece di normalizzarle', () => {
    for (const s of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-2', 'abc']) {
      expect(isValidIsoDate(s), s).toBe(false);
      expect(isoDateSchema.safeParse(s).success, s).toBe(false);
    }
  });
});
