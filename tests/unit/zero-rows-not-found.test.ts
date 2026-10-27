import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
let res: { data: unknown; error: unknown };

function builder() {
  const b: Record<string, unknown> = {
    update: () => b,
    delete: () => b,
    select: () => b,
    eq: () => b,
    then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ RateLimitedError: class RateLimitedError extends Error {}, enforceRateLimit: vi.fn() }));

import { toggleShoppingItem, deleteShoppingItem, deletePlanEntry } from '@/app/actions/planning';
import { removeFriendship } from '@/app/actions/social';
import { removeCollectionMember } from '@/app/actions/organize';

const ID = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';
const calls: [string, () => Promise<{ ok: boolean }>][] = [
  ['toggleShoppingItem', () => toggleShoppingItem(ID, true)],
  ['deleteShoppingItem', () => deleteShoppingItem(ID)],
  ['deletePlanEntry', () => deletePlanEntry(ID)],
  ['removeFriendship', () => removeFriendship(ID)],
  ['removeCollectionMember', () => removeCollectionMember(ID, ID)],
];

describe('UPDATE/DELETE su 0 righe', () => {
  beforeEach(() => getUser.mockResolvedValue({ id: 'u1' }));
  for (const [name, fn] of calls) {
    it(`${name}: not_found se nessuna riga`, async () => {
      res = { data: [], error: null };
      expect(await fn()).toMatchObject({ ok: false, error: 'not_found' });
    });
    it(`${name}: ok se una riga toccata`, async () => {
      res = { data: [{ id: ID }], error: null };
      expect(await fn()).toMatchObject({ ok: true });
    });
  }
});
