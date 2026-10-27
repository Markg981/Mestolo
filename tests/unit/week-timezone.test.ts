import { describe, expect, it } from 'vitest';
import { currentWeekStart, resolveTimeZone, todayIso } from '@/lib/plan/week';

describe('fuso orario utente per oggi/settimana', () => {
  // domenica 2026-03-08 23:30 a Los Angeles (PDT, UTC-7) = lunedi 06:30 UTC = lunedi 07:30 a Roma
  const now = new Date('2026-03-09T06:30:00Z');
  it('oggi e domenica a Los Angeles, lunedi a Roma', () => {
    expect(todayIso(now, 'America/Los_Angeles')).toBe('2026-03-08');
    expect(todayIso(now)).toBe('2026-03-09');
  });
  it('la settimana segue il fuso dell utente', () => {
    expect(currentWeekStart(now, 'America/Los_Angeles')).toBe('2026-03-02');
    expect(currentWeekStart(now)).toBe('2026-03-09');
  });
  it('un fuso non valido ricade su Europe/Rome', () => {
    expect(resolveTimeZone('Not/AZone')).toBe('Europe/Rome');
    expect(resolveTimeZone(null)).toBe('Europe/Rome');
    expect(resolveTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(todayIso(now, resolveTimeZone('Not/AZone'))).toBe('2026-03-09');
  });
});
