import { describe, expect, it } from 'vitest';
import { COOK_NOTE_MAX, cookPhotoPath, isCookVisibility, normalizeCookNote, parseCookDate, parseCookLogInput } from '@/lib/cooking/cook-log';

const now = new Date('2026-10-20T10:00:00Z');
const rid = '11111111-2222-4333-8444-555555555555';

describe('cook log validation', () => {
  it('normalises notes', () => {
    expect(normalizeCookNote('  ottima \r\n con basilico\u0007 ')).toBe('ottima \n con basilico');
    expect(normalizeCookNote(undefined)).toBe('');
    expect(normalizeCookNote('x'.repeat(COOK_NOTE_MAX))).toHaveLength(COOK_NOTE_MAX);
    expect(normalizeCookNote('x'.repeat(COOK_NOTE_MAX + 1))).toBeNull();
    expect(normalizeCookNote(42)).toBeNull();
  });

  it('parses dates', () => {
    expect(parseCookDate('', now)).toBe(now.toISOString());
    expect(parseCookDate('2026-10-18', now)).toBe('2026-10-18T12:00:00.000Z');
    expect(parseCookDate('2026-02-30', now)).toBeNull();
    expect(parseCookDate('18/10/2026', now)).toBeNull();
    expect(parseCookDate('2026-10-21', now)).toBe(now.toISOString());
    expect(parseCookDate('2026-10-25', now)).toBeNull();
    expect(parseCookDate('2000-01-01', now)).toBeNull();
    expect(parseCookDate(5, now)).toBeNull();
  });

  it('validates visibility', () => {
    expect(isCookVisibility('private')).toBe(true);
    expect(isCookVisibility('recipe')).toBe(true);
    expect(isCookVisibility('public')).toBe(false);
  });

  it('parses the whole input', () => {
    expect(parseCookLogInput({ recipeId: rid, note: 'buona', date: '2026-10-19', visibility: 'private' }, now)).toEqual({
      recipeId: rid,
      note: 'buona',
      cookedAt: '2026-10-19T12:00:00.000Z',
      visibility: 'private',
    });
    expect(parseCookLogInput({ recipeId: rid }, now)?.visibility).toBe('recipe');
    expect(parseCookLogInput({ recipeId: 'nope' }, now)).toBeNull();
    expect(parseCookLogInput({ recipeId: rid, visibility: 'friends' }, now)).toBeNull();
    expect(parseCookLogInput({ recipeId: rid, note: 'x'.repeat(2000) }, now)).toBeNull();
  });

  it('builds the storage path under the user folder', () => {
    expect(cookPhotoPath('u1', 'abc')).toBe('u1/cook/abc.webp');
  });
});
