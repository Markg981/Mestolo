import { describe, expect, it, vi } from 'vitest';
import { createTimeoutFetch } from '@/lib/supabase/fetch';

const hang: typeof fetch = (_i, init) =>
  new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)));

describe('createTimeoutFetch', () => {
  it('passes through fast responses', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const res = await createTimeoutFetch(1000, base as unknown as typeof fetch)('http://x');
    expect(await res.text()).toBe('ok');
  });

  it('rejects with TimeoutError when the request hangs', async () => {
    await expect(createTimeoutFetch(20, hang)('http://x')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('honours a caller-provided signal', async () => {
    const c = new AbortController();
    const p = createTimeoutFetch(5000, hang)('http://x', { signal: c.signal });
    c.abort(new Error('stop'));
    await expect(p).rejects.toThrow('stop');
  });
});
