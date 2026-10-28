import { revalidateTag } from 'next/cache';
import { PUBLIC_RECIPES_TAG, publicRecipeTag } from '@/lib/data/public-recipes';

/**
 * Scadenza immediata (expire: 0): con 'max' la richiesta successiva riceverebbe ancora la pagina vecchia
 * (stale-while-revalidate), quindi una ricetta rimossa o nascosta resterebbe visibile.
 */
const NOW = { expire: 0 } as const;

/** Invalida subito la pagina pubblica di uno slug (se noto) e le liste/sitemap. */
export function invalidatePublicPage(slug: string | null | undefined) {
  if (slug) revalidateTag(publicRecipeTag(slug), NOW);
  revalidateTag(PUBLIC_RECIPES_TAG, NOW);
}

/** Invalida tutte le pagine pubbliche (es. moderazione, profilo/avatar dell'autore, eliminazione account). */
export function invalidateAllPublicPages(slugs: Iterable<string | null | undefined> = []) {
  for (const s of slugs) if (s) revalidateTag(publicRecipeTag(s), NOW);
  revalidateTag(PUBLIC_RECIPES_TAG, NOW);
}

type SlugReader = {
  from: (t: 'recipes') => {
    select: (c: 'public_slug') => { eq: (c: 'id', v: string) => { maybeSingle: () => PromiseLike<{ data: { public_slug: string | null } | null }> } };
  };
};

/** Come invalidatePublicPage, ma risolve lo slug dalla ricetta (modifiche AI/immagini che hanno solo l'id). */
export async function invalidatePublicPageForRecipe(supabase: unknown, recipeId: string) {
  let slug: string | null = null;
  try {
    const { data } = await (supabase as SlugReader).from('recipes').select('public_slug').eq('id', recipeId).maybeSingle();
    slug = data?.public_slug ?? null;
  } catch {
    // slug non risolvibile: il tag globale invalida comunque ogni pagina pubblica
  }
  invalidatePublicPage(slug);
}
