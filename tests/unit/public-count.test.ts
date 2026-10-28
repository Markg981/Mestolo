import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ count: vi.fn(), configured: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/public-recipes', () => ({ countPublicRecipes: m.count }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: m.configured }));

import { countPublicRecipesSafe, resetPublicCountWarning } from '@/lib/seo/public-count';

describe('countPublicRecipesSafe', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetPublicCountWarning();
    m.configured.mockReturnValue(true);
  });
  it('returns the count', async () => {
    m.count.mockResolvedValue(42);
    expect(await countPublicRecipesSafe()).toBe(42);
  });
  it('returns 0 without touching the DB when Supabase is not configured', async () => {
    m.configured.mockReturnValue(false);
    expect(await countPublicRecipesSafe()).toBe(0);
    expect(m.count).not.toHaveBeenCalled();
  });
  it('falls back to 0 and logs the error only once', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.count.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await countPublicRecipesSafe()).toBe(0);
    expect(await countPublicRecipesSafe()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
