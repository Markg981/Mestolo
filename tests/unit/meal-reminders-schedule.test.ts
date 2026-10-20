import { describe, expect, it } from 'vitest';
import { notificationId, planReminders, rowToPrefs, zonedInstant, isValidTimeZone, type ReminderPrefs } from '@/lib/notifications/schedule';

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  enabled: true,
  timezone: 'Europe/Rome',
  times: { breakfast: null, lunch: '12:30', dinner: '19:00', snack: null },
  ...over,
});
const E = (id: string, plan_date: string, slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', title = 'Risotto') => ({ id, plan_date, slot, title });

describe('zonedInstant', () => {
  it('converts local wall time to the right UTC instant (winter and summer)', () => {
    expect(zonedInstant('2031-01-15', '19:00', 'Europe/Rome').toISOString()).toBe('2031-01-15T18:00:00.000Z');
    expect(zonedInstant('2031-07-15', '19:00', 'Europe/Rome').toISOString()).toBe('2031-07-15T17:00:00.000Z');
    expect(zonedInstant('2031-01-15', '19:00', 'America/New_York').toISOString()).toBe('2031-01-16T00:00:00.000Z');
    expect(zonedInstant('2031-01-15', '08:15', 'Asia/Kolkata').toISOString()).toBe('2031-01-15T02:45:00.000Z');
  });
  it('handles days on which daylight saving time changes', () => {
    // Europe/Rome: 2031-03-30 clocks go forward at 02:00; 2031-10-26 go back at 03:00
    expect(zonedInstant('2031-03-30', '19:00', 'Europe/Rome').toISOString()).toBe('2031-03-30T17:00:00.000Z');
    expect(zonedInstant('2031-10-26', '19:00', 'Europe/Rome').toISOString()).toBe('2031-10-26T18:00:00.000Z');
  });
});

describe('planReminders', () => {
  const now = new Date('2031-01-15T10:00:00Z');
  it('returns nothing when reminders are disabled', () => {
    expect(planReminders([E('a', '2031-01-15', 'dinner')], prefs({ enabled: false }), now)).toEqual([]);
  });
  it('schedules only future meals of slots that have a time, sorted by time', () => {
    const r = planReminders([E('b', '2031-01-16', 'dinner'), E('a', '2031-01-15', 'dinner'), E('c', '2031-01-15', 'lunch'), E('d', '2031-01-15', 'snack'), E('e', '2031-01-14', 'dinner')], prefs(), now);
    expect(r.map((x) => x.slot + x.at.toISOString())).toEqual(['lunch2031-01-15T11:30:00.000Z', 'dinner2031-01-15T18:00:00.000Z', 'dinner2031-01-16T18:00:00.000Z']);
  });
  it('skips reminders already past and beyond the 7-day horizon', () => {
    const r = planReminders([E('a', '2031-01-15', 'lunch'), E('b', '2031-01-22', 'dinner'), E('c', '2031-01-21', 'dinner')], prefs(), new Date('2031-01-15T12:00:00Z'));
    expect(r.map((x) => x.at.toISOString())).toEqual(['2031-01-21T18:00:00.000Z']);
  });
  it('ignores malformed times and dates', () => {
    expect(planReminders([E('a', '2031-01-16', 'dinner')], prefs({ times: { breakfast: null, lunch: null, dinner: '25:99', snack: null } }), now)).toEqual([]);
    expect(planReminders([E('a', 'tomorrow', 'dinner')], prefs(), now)).toEqual([]);
  });
});

describe('notificationId', () => {
  it('is stable, positive and fits a 32-bit signed int', () => {
    const id = '3f2b8c1e-9a4d-4c55-8f0e-1b2c3d4e5f60';
    expect(notificationId(id)).toBe(notificationId(id));
    expect(notificationId(id)).toBeGreaterThan(0);
    expect(notificationId(id)).toBeLessThanOrEqual(2147483647);
    expect(notificationId(id)).not.toBe(notificationId('3f2b8c1e-9a4d-4c55-8f0e-1b2c3d4e5f61'));
  });
});

describe('preferences helpers', () => {
  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Europe/Rome')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
  it('maps a database row (HH:MM:SS) and falls back to defaults', () => {
    expect(rowToPrefs({ enabled: true, timezone: 'UTC', breakfast_time: null, lunch_time: '12:00:00', dinner_time: '19:30:00', snack_time: null })).toEqual({
      enabled: true,
      timezone: 'UTC',
      times: { breakfast: null, lunch: '12:00', dinner: '19:30', snack: null },
    });
    expect(rowToPrefs(null).enabled).toBe(false);
  });
});
