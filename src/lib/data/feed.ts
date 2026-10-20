import 'server-only';
import { createClient, getProfile, getUser } from '@/lib/supabase/server';
import { conflictsWithPreferences } from '@/lib/discover/preferences';
import { attachCovers, LIST_COLUMNS, type RecipeListItem } from './recipes';
import type { Ingredient } from '@/lib/recipes/types';
import { PAGE_SIZE } from '@/lib/pagination';

/** Why a recipe is in the "Per te" feed (rendered as a caption on the card). */
export interface FeedReason {
  kind: 'friend' | 'tags' | 'category' | 'popular' | 'new';
  tags?: string[];
  categoryId?: string;
}

export type FeedItem = RecipeListItem & { reason: FeedReason };

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  /** at least one item matches the user's tastes (false for new users: cold start) */
  personalized: boolean;
}

interface FeedRow {
  id: string;
  score: number | string;
  is_friend: boolean;
  matched_tags: string[];
  matched_category: string | null;
  favorite_count: number;
}

/** Cursor = last (score, id) served + the snapshot instant that the scores were computed at. */
interface FeedCursor {
  s: string;
  i: string;
  n: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
const NUM = /^-?\d{1,12}(\.\d{1,6})?$/;

export function encodeFeedCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** Malformed or tampered cursors restart the feed from the first page. */
export function decodeFeedCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || typeof raw !== 'string' || raw.length > 400) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FeedCursor>;
    if (!o || typeof o.s !== 'string' || !NUM.test(o.s) || typeof o.i !== 'string' || !UUID.test(o.i)) return null;
    if (typeof o.n !== 'string' || Number.isNaN(Date.parse(o.n))) return null;
    return { s: o.s, i: o.i, n: new Date(o.n).toISOString() };
  } catch {
    return null;
  }
}

export function reasonFor(row: Pick<FeedRow, 'is_friend' | 'matched_tags' | 'matched_category' | 'favorite_count'>): FeedReason {
  if (row.is_friend) return { kind: 'friend' };
  if (row.matched_tags.length) return { kind: 'tags', tags: row.matched_tags };
  if (row.matched_category) return { kind: 'category', categoryId: row.matched_category };
  return row.favorite_count > 0 ? { kind: 'popular' } : { kind: 'new' };
}

/** Personalized feed (SQL function feed_recipes, RLS applies). */
export async function listFeed(opts: { cursor?: string | null; limit?: number } = {}): Promise<FeedPage> {
  const empty: FeedPage = { items: [], nextCursor: null, personalized: false };
  const user = await getUser();
  const profile = await getProfile();
  if (!user || !profile) return empty;
  const supabase = await createClient();
  const limit = opts.limit ?? PAGE_SIZE;
  const cur = decodeFeedCursor(opts.cursor);
  const { data, error } = await supabase.rpc('feed_recipes', {
    p_limit: limit + 1,
    p_now: cur?.n ?? new Date().toISOString(),
    p_before_score: cur ? Number(cur.s) : null,
    p_before_id: cur?.i ?? null,
  });
  if (error || !data) return empty;
  const all = data as FeedRow[];
  const rows = all.slice(0, limit);
  const snapshot = cur?.n ?? new Date().toISOString();
  const last = rows[rows.length - 1];
  const nextCursor = all.length > limit && last ? encodeFeedCursor({ s: String(last.score), i: last.id, n: snapshot }) : null;
  if (!rows.length) return { ...empty, nextCursor };

  const { data: recipes } = await supabase.from('recipes').select(`${LIST_COLUMNS}, ingredients`).in('id', rows.map((r) => r.id));
  const byId = new Map(((recipes as (RecipeListItem & { ingredients: Ingredient[] })[]) ?? []).map((r) => [r.id, r]));
  // keep the SQL order; skip rows that vanished or conflict with declared (indicative) preferences
  const kept = rows.flatMap((row) => {
    const r = byId.get(row.id);
    if (!r || conflictsWithPreferences(r.ingredients ?? [], profile)) return [];
    const { ingredients: _ingredients, ...rest } = r;
    void _ingredients;
    return [{ ...rest, reason: reasonFor(row) }];
  });
  const ownerIds = [...new Set(kept.map((r) => r.owner_id))];
  const { data: owners } = ownerIds.length ? await supabase.from('profiles').select('id, username').in('id', ownerIds) : { data: [] };
  const names = new Map(((owners as { id: string; username: string }[]) ?? []).map((o) => [o.id, o.username]));
  const withOwner = kept.map((r) => ({ ...r, ownerUsername: names.get(r.owner_id) ?? null }));
  const covered = await attachCovers(withOwner);
  const items = covered.map((c, i) => ({ ...c, reason: withOwner[i].reason })) as FeedItem[];
  return { items, nextCursor, personalized: rows.some((r) => r.is_friend || r.matched_tags.length > 0 || r.matched_category) };
}
