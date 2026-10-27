import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createClient: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ getUser: mocks.getUser, createClient: mocks.createClient, getProfile: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { saveRecipe } from '@/app/actions/recipes';
import { applyAnalysis } from '@/app/actions/ai';

const RID = '11111111-1111-4111-8111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';

/** Chainable query-builder stub: every call returns itself, awaiting resolves `result`. */
function builder(result: unknown, spy?: (name: string, args: unknown[]) => void) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq', 'upsert', 'delete']) {
    b[m] = (...a: unknown[]) => {
      spy?.(m, a);
      return b;
    };
  }
  b.single = async () => result;
  b.maybeSingle = async () => result;
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return b;
}

describe('saveRecipe: creazione idempotente', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ id: 'u1' });
  });
  const payload = { title: 'Pasta', servings: 1, prep_minutes: null, cook_minutes: null, total_minutes: null, category_id: null, tags: [], ingredients: [], steps: [] };

  it('returns the existing recipe when the key was already used', async () => {
    const inserted = vi.fn();
    mocks.createClient.mockResolvedValue({
      from: () => builder({ data: { id: 'existing' }, error: null }, (m) => m === 'insert' && inserted()),
    });
    const res = await saveRecipe(payload, null, null, KEY);
    expect(res).toEqual({ ok: true, data: { id: 'existing' } });
    expect(inserted).not.toHaveBeenCalled();
  });

  it('recovers from a unique violation raised by a concurrent insert', async () => {
    let call = 0;
    mocks.createClient.mockResolvedValue({
      from: () => {
        call++;
        if (call === 1) return builder({ data: null, error: null }); // lookup: nothing yet
        if (call === 2) return builder({ data: null, error: { code: '23505', message: 'dup' } }); // insert loses the race
        return builder({ data: { id: 'winner' }, error: null }); // lookup again
      },
    });
    const res = await saveRecipe(payload, null, null, KEY);
    expect(res).toEqual({ ok: true, data: { id: 'winner' } });
  });
});

describe('saveRecipe: errori su note e nutrizione', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ id: 'u1' });
  });
  const base = { title: 'Pasta', servings: 1, prep_minutes: null, cook_minutes: null, total_minutes: null, category_id: null, tags: [], ingredients: [], steps: [], personal_note: 'ciao' };

  it('fails and removes the new recipe when the note write fails', async () => {
    const deleted = vi.fn();
    let call = 0;
    mocks.createClient.mockResolvedValue({
      from: (t: string) => {
        if (t === 'recipe_notes') return builder({ data: null, error: { code: 'XX', message: 'boom' } });
        call++;
        if (call === 1) return builder({ data: null, error: null }); // lookup idempotenza
        if (call === 2) return builder({ data: { id: RID }, error: null }); // insert
        return builder({ data: null, error: null }, (m) => m === 'delete' && deleted()); // compensazione
      },
    });
    const res = await saveRecipe(base, null, null, KEY);
    expect(res.ok).toBe(false);
    expect(deleted).toHaveBeenCalled();
  });

  it('rejects an update without expectedVersion', async () => {
    mocks.createClient.mockResolvedValue({ from: () => builder({ data: { id: RID, public_slug: null }, error: null }) });
    const res = await saveRecipe(base, RID, null, null);
    expect(res).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('fails on update when the note write fails', async () => {
    mocks.createClient.mockResolvedValue({
      from: (t: string) =>
        t === 'recipe_notes'
          ? builder({ data: null, error: { code: 'XX', message: 'boom' } })
          : builder({ data: { id: RID, public_slug: null }, error: null }),
    });
    const res = await saveRecipe(base, RID, 3, null);
    expect(res.ok).toBe(false);
  });
});

describe('applyAnalysis: concorrenza ottimistica', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ id: 'u1' });
  });

  it('returns conflict when the UPDATE (filtered by content_hash) touches 0 rows', async () => {
    const recipe = {
      id: RID,
      title: 'A',
      description: null,
      original_language: 'it',
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      total_minutes: null,
      ingredients: [],
      steps: [{ text: 'old' }],
      category_id: null,
      tags: [],
      field_flags: {},
      content_hash: 'h1',
    };
    const analysis = { summary: 's', suggestions: [{ id: 'x1', type: 'time_estimate', field: 'prep_minutes', before: null, after: 10, reason: 'r' }] };
    const eqs: unknown[][] = [];
    const spy = (m: string, a: unknown[]) => m === 'eq' && eqs.push(a);
    let call = 0;
    mocks.createClient.mockResolvedValue({
      from: () => {
        call++;
        if (call === 1) return builder({ data: recipe, error: null }, spy); // recipe select
        if (call === 2) return builder({ data: { payload: analysis, recipe_hash: 'h1' }, error: null }, spy); // suggestion select
        return builder({ data: [], error: null }, spy); // UPDATE matches 0 rows: the recipe changed meanwhile
      },
    });
    const res = await applyAnalysis(RID, AID, ['x1'], 'apply');
    expect(res).toMatchObject({ ok: false, error: 'conflict' });
    expect(eqs).toContainEqual(['content_hash', 'h1']);
  });
});
