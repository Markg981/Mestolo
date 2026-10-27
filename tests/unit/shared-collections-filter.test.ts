import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const calls: { or?: string; limit?: number } = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'neq', 'in', 'order']) b[m] = self;
  b.or = (f: string) => { calls.or = f; return b; };
  b.limit = (n: number) => { calls.limit = n; return b; };
  const data =
    table === 'collection_members' ? [{ collection_id: 'c1', role: 'editor' }] :
    table === 'friendships' ? [{ requester_id: 'u1', addressee_id: 'f1' }] :
    table === 'collections' ? [{ id: 'c1', owner_id: 'o1', name: 'N', description: '', collection_recipes: [{ count: 2 }] }] : [];
  b.then = (res: (v: unknown) => unknown) => res({ data });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => ({ id: 'u1' }),
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));

import { listSharedCollections } from '@/lib/data/recipes';

describe('listSharedCollections', () => {
  it('filtra per appartenenza/amicizia nel DB prima del limit', async () => {
    const r = await listSharedCollections();
    expect(calls.or).toBe('id.in.(c1),owner_id.in.(f1)');
    expect(calls.limit).toBe(200);
    expect(r[0]).toMatchObject({ id: 'c1', role: 'editor', count: 2 });
  });
});
