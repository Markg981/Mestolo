import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => ({ id: 'u1' }),
  createClient: async () => ({ rpc: async () => ({ error: null }) }),
}));

import { moderateReport } from './moderation';

describe('moderateReport', () => {
  it('nascondere una ricetta invalida le pagine pubbliche con scadenza immediata', async () => {
    const res = await moderateReport('11111111-1111-4111-8111-111111111111', 'hide');
    expect(res.ok).toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith('public-recipes', { expire: 0 });
  });
});
