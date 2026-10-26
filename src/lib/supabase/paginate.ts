/**
 * PostgREST (Supabase) caps every response at `max_rows` (1000) without an
 * error, so a plain select silently truncates. These helpers read a table page
 * by page until exhausted and keep `.in()` lists short enough for the URL.
 */
export const PAGE_SIZE = 1000;
export const IN_CHUNK = 100;

export interface PageResult {
  data: unknown[] | null;
  error: { code?: string } | null;
}
type PageFetcher = (from: number, to: number) => PromiseLike<PageResult>;

/** `fetchPage` must apply a stable, unique `.order()` and `.range(from, to)`. */
export async function fetchAllPages(fetchPage: PageFetcher, pageSize = PAGE_SIZE): Promise<PageResult> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

/** Paginated read once per chunk of `ids`; the first error wins. */
export async function fetchAllChunked(
  ids: string[],
  fetchPage: (chunk: string[], from: number, to: number) => PromiseLike<PageResult>,
  chunkSize = IN_CHUNK,
): Promise<PageResult> {
  const rows: unknown[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = await fetchAllPages((from, to) => fetchPage(chunk, from, to));
    if (res.error) return res;
    rows.push(...(res.data ?? []));
  }
  return { data: rows, error: null };
}
