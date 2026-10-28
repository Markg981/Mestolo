import { beforeEach, describe, expect, it, vi } from 'vitest';

// restoreVersion must drop the cached public page (old and new slug), otherwise it lives on for up to 1 hour.
const getUser = vi.fn();
const revalidateTag = vi.fn();
let slugBefore: string | null;
let updated: { id: string; public_slug: string | null }[];

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'recipe_versions') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { snapshot: { title: 'T' } } }) }) }) }) };
      const chain: Record<string, unknown> = {
        select: (cols: string) => (cols.startsWith('public_slug') ? { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { public_slug: slugBefore } }) }) }) } : chain),
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        then: (r: (v: unknown) => unknown) => r({ data: updated, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, revalidateTag: (...a: unknown[]) => revalidateTag(...a), updateTag: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }), headers: async () => new Headers() }));

import { restoreVersion } from '@/app/actions/recipes';

const id = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ id: 'u1' });
});

describe('restoreVersion public page invalidation', () => {
  it('invalidates the slug of the restored recipe and the sitemap', async () => {
    slugBefore = 'torta';
    updated = [{ id, public_slug: 'torta' }];
    expect(await restoreVersion(id, 1, 2)).toMatchObject({ ok: true });
    expect(revalidateTag).toHaveBeenCalledWith('public-recipe:torta', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('public-recipes', { expire: 0 });
  });

  it('invalidates both the old and the new slug when it changes', async () => {
    slugBefore = 'torta';
    updated = [{ id, public_slug: 'torta-nuova' }];
    await restoreVersion(id, 1, 2);
    expect(revalidateTag).toHaveBeenCalledWith('public-recipe:torta', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('public-recipe:torta-nuova', { expire: 0 });
  });
});
