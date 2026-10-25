import { describe, expect, it } from 'vitest';
import { pickOfTheDay } from '@/lib/discover/preferences';

const mk = (id: string, created_at: string) => ({ id, created_at });

describe('pickOfTheDay', () => {
  const base = Array.from({ length: 7 }, (_, i) => mk(`r${i}`, `2026-10-0${i + 1}T10:00:00Z`));

  it('is stable when a new recipe is published during the day', () => {
    for (const user of ['u1', 'u2', 'u3', 'u4']) {
      const before = pickOfTheDay(base, user, '2026-10-25');
      const withNew = [...base, mk('a-new', '2026-10-25T09:30:00Z'), mk('z-new', '2026-10-25T15:00:00Z')];
      expect(pickOfTheDay(withNew, user, '2026-10-25')).toEqual(before);
    }
  });

  it('falls back to all recipes when none predates the day', () => {
    const only = [mk('x', '2026-10-25T08:00:00Z')];
    expect(pickOfTheDay(only, 'u1', '2026-10-25')).toEqual(only[0]);
  });

  it('returns null for an empty pool', () => {
    expect(pickOfTheDay([], 'u1', '2026-10-25')).toBeNull();
  });
});
