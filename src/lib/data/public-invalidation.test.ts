import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag, unstable_cache: (fn: unknown) => fn }));

import { invalidateAllPublicPages, invalidatePublicPage, invalidatePublicPageForRecipe } from './public-invalidation';
import { PUBLIC_RECIPES_TAG, publicRecipeTag } from './public-recipes';

beforeEach(() => revalidateTag.mockClear());

describe('invalidazione pagine pubbliche', () => {
  it('usa scadenza immediata (expire: 0), mai "max" che serve la pagina vecchia', () => {
    invalidatePublicPage('torta');
    expect(revalidateTag).toHaveBeenCalledWith(publicRecipeTag('torta'), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_RECIPES_TAG, { expire: 0 });
    expect(revalidateTag.mock.calls.some((c) => c[1] === 'max')).toBe(false);
  });

  it('senza slug invalida solo il tag globale', () => {
    invalidatePublicPage(null);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_RECIPES_TAG, { expire: 0 });
  });

  it('invalidateAllPublicPages invalida ogni slug e il tag globale', () => {
    invalidateAllPublicPages(['a', null, 'b']);
    expect(revalidateTag).toHaveBeenCalledWith(publicRecipeTag('a'), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(publicRecipeTag('b'), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_RECIPES_TAG, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledTimes(3);
  });

  it('invalidatePublicPageForRecipe risolve lo slug dalla ricetta', async () => {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { public_slug: 'zuppa' } }) }) }) }) };
    await invalidatePublicPageForRecipe(sb, 'rid');
    expect(revalidateTag).toHaveBeenCalledWith(publicRecipeTag('zuppa'), { expire: 0 });
  });

  it('se la lettura dello slug fallisce invalida comunque il tag globale', async () => {
    const sb = { from: () => { throw new Error('boom'); } };
    await invalidatePublicPageForRecipe(sb, 'rid');
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_RECIPES_TAG, { expire: 0 });
  });
});
