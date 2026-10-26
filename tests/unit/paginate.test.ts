import { describe, expect, it, vi } from 'vitest';
import { fetchAllChunked, fetchAllPages } from '@/lib/supabase/paginate';

const rows = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i }));

describe('fetchAllPages', () => {
  it('requests the next page after a full 1000-row page and concatenates', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(1000), error: null })
      .mockResolvedValueOnce({ data: rows(5, 1000), error: null });
    const res = await fetchAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1005);
  });

  it('stops after a short page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ data: rows(3), error: null });
    const res = await fetchAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.data).toHaveLength(3);
  });

  it('an error on a later page fails the whole read', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '57014' } });
    const res = await fetchAllPages(fetchPage);
    expect(res.error).toEqual({ code: '57014' });
    expect(res.data).toBeNull();
  });
});

describe('fetchAllChunked', () => {
  it('splits ids into chunks of 100', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `r${i}`);
    const fetchPage = vi.fn().mockResolvedValue({ data: rows(1), error: null });
    const res = await fetchAllChunked(ids, fetchPage);
    expect(fetchPage.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(res.data).toHaveLength(3);
  });

  it('propagates an error from a later chunk', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `r${i}`);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(1), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'XX' } });
    const res = await fetchAllChunked(ids, fetchPage);
    expect(res.error).toEqual({ code: 'XX' });
  });
});
