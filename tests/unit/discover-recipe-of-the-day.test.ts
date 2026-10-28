import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Row = { id: string; owner_id: string; created_at: string; ingredients: { name: string }[] };
const state: { rows: Row[]; error: { message: string } | null; limits: number[] } = { rows: [], error: null, limits: [] };

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'neq', 'in', 'eq', 'or', 'order']) b[m] = () => b;
  b.limit = (n: number) => {
    state.limits.push(n);
    return Promise.resolve({ data: state.error ? null : state.rows.slice(0, n), error: state.error });
  };
  b.maybeSingle = () => Promise.resolve({ data: { username: 'x' }, error: null });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => builder() }),
  getUser: async () => ({ id: 'u1' }),
  getProfile: async () => ({ hidden_categories: [], diets: [], avoided_ingredients: [] }),
  getUserTimeZone: async () => 'Europe/Rome',
}));
vi.mock('@/lib/data/recipes', () => ({
  LIST_COLUMNS: 'id',
  attachCovers: async (x: unknown[]) => x,
}));

import { discover } from '@/lib/data/discover';

beforeEach(() => {
  state.rows = Array.from({ length: 80 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, owner_id: 'o', created_at: '2020-01-01T00:00:00Z', ingredients: [] }));
  state.error = null;
  state.limits = [];
});

describe('discover - ricetta del giorno', () => {
  it('home (limit 6) e discover (default) scelgono la stessa ricetta', async () => {
    const home = await discover([], { limit: 6 });
    const page = await discover([]);
    expect(home.recipeOfTheDay).not.toBeNull();
    expect(home.recipeOfTheDay?.id).toBe(page.recipeOfTheDay?.id);
  });

  it('propaga l errore della query invece di restituire una lista vuota', async () => {
    state.error = { message: 'boom' };
    await expect(discover([])).rejects.toThrow(/boom/);
  });
});
