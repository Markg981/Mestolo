import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/data/public-recipes', () => ({ PUBLIC_RECIPES_TAG: 'p', publicRecipeTag: (s: string) => s }));

const RID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = {
  title: 'T', description: 'D', original_language: 'it', servings: 4, prep_minutes: 1, cook_minutes: 2, total_minutes: 3,
  ingredients: [{ name: 'a' }], steps: [{ text: 's' }], category_id: null, tags: ['x'],
};
let dbVersion = 5;
let lastUpdate: Record<string, unknown> | null = null;

function client() {
  return {
    from: (table: string) => {
      if (table === 'recipe_versions') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { snapshot: SNAPSHOT } }) }) }) }) };
      }
      let expected: number | undefined;
      const q = {
        update: (v: Record<string, unknown>) => { lastUpdate = v; return q; },
        select: () => q,
        delete: () => q,
        eq: (c: string, v: unknown) => { if (c === 'version') expected = v as number; return q; },
        maybeSingle: async () => ({ data: { id: RID } }),
        then: (res: (v: unknown) => unknown) => res({ data: expected === dbVersion ? [{ id: RID }] : [], error: null }),
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ getUser: async () => ({ id: 'u1' }), createClient: async () => client() }));

import { restoreVersion } from './recipes';

describe('restoreVersion', () => {
  beforeEach(() => { dbVersion = 5; lastUpdate = null; });

  it('la seconda operazione concorrente fallisce con conflict', async () => {
    const first = await restoreVersion(RID, 2, 5);
    expect(first.ok).toBe(true);
    dbVersion = 6; // il primo ripristino ha incrementato la versione
    const second = await restoreVersion(RID, 3, 5);
    expect(second).toMatchObject({ ok: false, error: 'conflict' });
  });

  it('ripristina tutti i campi dello snapshot', async () => {
    await restoreVersion(RID, 2, 5);
    for (const [k, v] of Object.entries(SNAPSHOT)) expect(lastUpdate).toHaveProperty(k, v);
  });
});
