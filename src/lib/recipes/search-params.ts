import type { Cursor } from '@/lib/pagination';

/** Tetto reale di righe che l'RPC search_recipes restituisce per chiamata (vedi la migrazione). */
export const SEARCH_RPC_MAX_LIMIT = 200;

export interface SearchParamsInput {
  q: string;
  owner: string | null;
  sort?: 'recent' | 'updated' | 'title' | 'quick';
  favorites?: boolean;
  category?: string;
  tag?: string;
  review?: boolean;
  /** righe richieste (pageSize + 1 per rilevare la pagina successiva) */
  limit: number;
  cursor?: Cursor | null;
}

/**
 * Parametri dell'RPC search_recipes. Ordinamento, preferiti, filtri e cursore keyset sono
 * applicati dentro la funzione PRIMA del limit, cosi' il tetto di 200 righe non tronca i risultati.
 */
export function buildSearchRpcParams(i: SearchParamsInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    p_query: i.q.slice(0, 100),
    p_owner: i.owner,
    p_limit: Math.min(Math.max(Math.trunc(i.limit), 1), SEARCH_RPC_MAX_LIMIT),
    p_sort: i.sort ?? 'recent',
    p_only_favorites: !!i.favorites,
  };
  if (i.category) p.p_category = i.category;
  if (i.tag) p.p_tag = i.tag;
  if (i.review) p.p_needs_review = true;
  if (i.cursor) {
    if (i.cursor.v === null) p.p_after_is_null = true;
    else p.p_after_value = String(i.cursor.v);
    p.p_after_id = i.cursor.i;
  }
  return p;
}
