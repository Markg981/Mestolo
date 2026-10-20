/**
 * Generic keyset (cursor) pagination helpers. The cursor encodes the sort value
 * and the id of the last row served; the next page is "everything after that
 * row" in (sort column, id) order, so inserts/deletes never shift pages.
 * Pure functions, no I/O: reusable by any list (and by search).
 */

export const PAGE_SIZE = 24;

export type CursorValue = string | number | null;

export interface Cursor {
  /** value of the sort column of the last row served (null for a NULL sort value) */
  v: CursorValue;
  /** id of the last row served (tie-breaker) */
  i: string;
}

export interface KeysetSort {
  column: string;
  ascending: boolean;
  /** the column may contain NULLs, which are always ordered last (see applyKeyset) */
  nullable?: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** Returns null for anything malformed: a tampered cursor just restarts from the first page. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || typeof raw !== 'string' || raw.length > 400) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (!o || typeof o.i !== 'string' || !UUID.test(o.i)) return null;
    if (o.v !== null && typeof o.v !== 'string' && typeof o.v !== 'number') return null;
    if (typeof o.v === 'number' && !Number.isFinite(o.v)) return null;
    return { v: o.v, i: o.i };
  } catch {
    return null;
  }
}

/** Quotes a value for use inside a PostgREST `or=(...)` filter. */
function quote(v: string | number): string {
  return typeof v === 'number' ? String(v) : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** PostgREST `or` expression selecting the rows strictly after `cursor` for the order `column dir, id dir`, NULLs last. */
export function keysetFilter(sort: KeysetSort, cursor: Cursor): string {
  const { column: col, ascending } = sort;
  const op = ascending ? 'gt' : 'lt';
  if (cursor.v === null) {
    // already in the trailing NULL group: only ties on id remain
    return `and(${col}.is.null,id.${op}.${cursor.i})`;
  }
  const v = quote(cursor.v);
  const parts = [`${col}.${op}.${v}`, `and(${col}.eq.${v},id.${op}.${cursor.i})`];
  if (sort.nullable) parts.push(`${col}.is.null`);
  return parts.join(',');
}

interface KeysetQuery {
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): KeysetQuery;
  or(filters: string): KeysetQuery;
  limit(n: number): KeysetQuery;
}

/** Applies the (column, id) ordering, the cursor condition and a pageSize+1 limit (to detect a next page). */
export function applyKeyset<Q>(query: Q, sort: KeysetSort, cursor: Cursor | null, pageSize = PAGE_SIZE): Q {
  let q = query as unknown as KeysetQuery;
  if (cursor) q = q.or(keysetFilter(sort, cursor));
  return q
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order('id', { ascending: sort.ascending })
    .limit(pageSize + 1) as unknown as Q;
}

/** Splits the pageSize+1 rows fetched by `applyKeyset` into the page and the cursor of the next one. */
export function toPage<T extends { id: string }>(rows: T[], sort: KeysetSort, pageSize = PAGE_SIZE): Page<T> {
  const items = rows.slice(0, pageSize);
  if (rows.length <= pageSize) return { items, nextCursor: null };
  const last = items[items.length - 1] as T & Record<string, unknown>;
  const raw = last[sort.column];
  const v = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
  return { items, nextCursor: encodeCursor({ v, i: last.id }) };
}
