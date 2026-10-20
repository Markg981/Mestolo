import { describe, expect, it } from 'vitest';
import { normalizeWebsite, parseCuisines, richProfileSchema } from '@/lib/profile/validation';

describe('normalizeWebsite', () => {
  it('accepts https links and adds the scheme to bare domains', () => {
    expect(normalizeWebsite('https://example.com/ricette')).toBe('https://example.com/ricette');
    expect(normalizeWebsite('example.com')).toBe('https://example.com/');
  });
  it('treats empty input as no website', () => {
    expect(normalizeWebsite('   ')).toBeNull();
  });
  it.each(['http://example.com', 'javascript:alert(1)', 'ftp://x.com', 'https://user:pw@example.com', 'https://localhost', 'https://a b.com', `https://example.com/${'a'.repeat(200)}`])('rejects %s', (v) => {
    expect(normalizeWebsite(v)).toBeUndefined();
  });
});

describe('parseCuisines', () => {
  it('trims, lowercases and deduplicates', () => {
    expect(parseCuisines(' Italiana, giapponese ,ITALIANA,,')).toEqual(['italiana', 'giapponese']);
  });
});

describe('richProfileSchema', () => {
  const base = { bio: 'ciao', location: 'Roma', website: '', favorite_cuisines: ['italiana'], profile_visibility: 'friends' as const };
  it('accepts a valid profile', () => {
    const r = richProfileSchema.safeParse(base);
    expect(r.success && r.data.website).toBeNull();
  });
  it('enforces the limits', () => {
    expect(richProfileSchema.safeParse({ ...base, bio: 'x'.repeat(281) }).success).toBe(false);
    expect(richProfileSchema.safeParse({ ...base, location: 'x'.repeat(81) }).success).toBe(false);
    expect(richProfileSchema.safeParse({ ...base, favorite_cuisines: Array.from({ length: 9 }, (_, i) => `c${i}`) }).success).toBe(false);
    expect(richProfileSchema.safeParse({ ...base, favorite_cuisines: ['x'.repeat(31)] }).success).toBe(false);
    expect(richProfileSchema.safeParse({ ...base, website: 'http://example.com' }).success).toBe(false);
    expect(richProfileSchema.safeParse({ ...base, profile_visibility: 'everyone' }).success).toBe(false);
  });
});
