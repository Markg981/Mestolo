import { describe, expect, it } from 'vitest';
import { localDayStart, pickOfTheDay } from '@/lib/discover/preferences';

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

describe('pickOfTheDay con fuso orario', () => {
  const pool = [mk('a', '2026-10-01T10:00:00Z'), mk('b', '2026-10-02T10:00:00Z'), mk('c', '2026-10-03T10:00:00Z')];

  it('localDayStart rispetta il fuso (Roma, CEST = UTC+2)', () => {
    expect(localDayStart('2026-10-25', null)).toBe(Date.parse('2026-10-25T00:00:00Z'));
    expect(localDayStart('2026-07-10', 'Europe/Rome')).toBe(Date.parse('2026-07-09T22:00:00Z'));
    expect(localDayStart('2026-12-10', 'Europe/Rome')).toBe(Date.parse('2026-12-09T23:00:00Z'));
  });

  it('una ricetta pubblicata dopo mezzanotte locale ma prima di mezzanotte UTC non e idonea', () => {
    const late = mk('late', '2026-07-09T22:30:00Z'); // 00:30 del 10 luglio a Roma
    const older = [mk('a', '2026-06-01T10:00:00Z'), mk('b', '2026-06-02T10:00:00Z'), mk('c', '2026-06-03T10:00:00Z')];
    const withLate = [...older, late];
    for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      expect(pickOfTheDay(withLate, u, '2026-07-10', 'Europe/Rome')).toEqual(pickOfTheDay(older, u, '2026-07-10', 'Europe/Rome'));
    }
  });

  it('stesso pool, utente e giorno danno la stessa ricetta; il giorno cambia il seme', () => {
    expect(pickOfTheDay(pool, 'u1', '2026-10-25', 'Europe/Rome')).toEqual(pickOfTheDay([...pool].reverse(), 'u1', '2026-10-25', 'Europe/Rome'));
    const picks = new Set(Array.from({ length: 20 }, (_, i) => pickOfTheDay(pool, 'u1', `2026-10-${String(i + 1).padStart(2, '0')}`, 'Europe/Rome')?.id));
    expect(picks.size).toBeGreaterThan(1);
  });
});
