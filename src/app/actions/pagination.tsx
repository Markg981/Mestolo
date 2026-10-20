'use server';

import type { ReactNode } from 'react';
import { getUser } from '@/lib/supabase/server';
import { discover } from '@/lib/data/discover';
import { listCategories, listMyRecipesPage, parseRecipeFilters } from '@/lib/data/recipes';
import { RecipeCard, RecipeGrid } from '@/components/recipes/RecipeCard';

/** Next page of cards, rendered on the server (RLS applies: reads go through the user's client). */
export interface MorePage {
  content: ReactNode;
  nextCursor: string | null;
}

const EMPTY: MorePage = { content: null, nextCursor: null };

type RecipesParams = { q?: string; category?: string; sort?: string; fav?: string; review?: string; tag?: string };

export async function loadMoreMyRecipes(params: RecipesParams, cursor: string): Promise<MorePage> {
  if (!(await getUser()) || typeof cursor !== 'string') return EMPTY;
  const filters = parseRecipeFilters(params ?? {});
  const [categories, page] = await Promise.all([listCategories(), listMyRecipesPage(filters, cursor)]);
  return {
    nextCursor: page.nextCursor,
    content: (
      <RecipeGrid>
        {page.items.map((r) => (
          <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor={filters.favorites} />
        ))}
      </RecipeGrid>
    ),
  };
}

export async function loadMoreDiscover(params: { category?: string }, cursor: string): Promise<MorePage> {
  if (!(await getUser()) || typeof cursor !== 'string') return EMPTY;
  const categories = await listCategories();
  const category = params?.category && categories.some((c) => c.owner_id === null && c.id === params.category) ? params.category : undefined;
  const { items, nextCursor } = await discover(categories, { category, cursor });
  return {
    nextCursor,
    content: (
      <RecipeGrid>
        {items.map((r) => (
          <RecipeCard key={r.id} recipe={r} categories={categories} showAuthor />
        ))}
      </RecipeGrid>
    ),
  };
}
