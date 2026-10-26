import { describe, expect, it } from 'vitest';
import { currentWeekStart, todayIso } from '@/lib/plan/week';

describe('todayIso / currentWeekStart (Europe/Rome)', () => {
  it('Monday 00:30 Rome (Sunday 22:30 UTC) is already Monday', () => {
    const now = new Date('2026-10-18T22:30:00Z'); // CEST: 2026-10-19 00:30
    expect(todayIso(now)).toBe('2026-10-19');
    expect(currentWeekStart(now)).toBe('2026-10-19');
  });
  it('Monday 00:30 Rome in winter time (CET)', () => {
    const now = new Date('2026-11-01T23:30:00Z'); // 2026-11-02 00:30 CET
    expect(todayIso(now)).toBe('2026-11-02');
    expect(currentWeekStart(now)).toBe('2026-11-02');
  });
  it('handles the autumn DST change (2026-10-25)', () => {
    expect(todayIso(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(todayIso(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
    expect(todayIso(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
    expect(currentWeekStart(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-19');
    expect(currentWeekStart(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
  it('handles the spring DST change (2026-03-29)', () => {
    expect(todayIso(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(todayIso(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
    expect(todayIso(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
  });
  it('honours an explicit zone', () => {
    expect(todayIso(new Date('2026-10-18T22:30:00Z'), 'UTC')).toBe('2026-10-18');
  });
});
