import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({}));
vi.mock('@/lib/data/recipes', () => ({ attachCovers: async (r: unknown[]) => r, LIST_COLUMNS: '' }));
vi.mock('@/lib/discover/preferences', () => ({ conflictsWithPreferences: () => false }));

const { decodeFeedCursor, encodeFeedCursor, reasonFor } = await import('@/lib/data/feed');

describe('feed cursor', () => {
  const c = { s: '101.234567', i: '123e4567-e89b-12d3-a456-426614174000', n: '2026-10-20T10:00:00.000Z' };

  it('round-trips', () => {
    expect(decodeFeedCursor(encodeFeedCursor(c))).toEqual(c);
  });

  it('rejects malformed or tampered cursors', () => {
    expect(decodeFeedCursor(null)).toBeNull();
    expect(decodeFeedCursor('not-base64-json')).toBeNull();
    expect(decodeFeedCursor(encodeFeedCursor({ ...c, s: '1; drop table' }))).toBeNull();
    expect(decodeFeedCursor(encodeFeedCursor({ ...c, i: 'x' }))).toBeNull();
    expect(decodeFeedCursor(encodeFeedCursor({ ...c, n: 'yesterday' }))).toBeNull();
  });
});

describe('reasonFor', () => {
  const base = { is_friend: false, matched_tags: [], matched_category: null, favorite_count: 0 };
  it('prefers friend, then tags, then category, then popularity', () => {
    expect(reasonFor({ ...base, is_friend: true, matched_tags: ['a'] }).kind).toBe('friend');
    expect(reasonFor({ ...base, matched_tags: ['a'] })).toEqual({ kind: 'tags', tags: ['a'] });
    expect(reasonFor({ ...base, matched_category: 'x' }).kind).toBe('category');
    expect(reasonFor({ ...base, favorite_count: 2 }).kind).toBe('popular');
    expect(reasonFor(base).kind).toBe('new');
  });
});
