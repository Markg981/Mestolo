import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const revalidatePath = vi.fn();
type Op = { table: string; op: string; eqs: [string, unknown][]; payload?: Record<string, unknown> };
const ops: Op[] = [];
let recipe: unknown;
let suggestion: unknown;
let writeRes: { data?: unknown; error: unknown };

function builder(table: string) {
  const st: Op = { table, op: 'select', eqs: [] };
  ops.push(st);
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Record<string, unknown>) => ((st.op = 'update'), (st.payload = p), b),
    insert: (p: Record<string, unknown>) => ((st.op = 'insert'), (st.payload = p), b),
    eq: (c: string, v: unknown) => (st.eqs.push([c, v]), b),
    maybeSingle: async () => ({ data: table === 'recipes' ? recipe : suggestion }),
    single: async () => writeRes,
    then: (res: (v: unknown) => unknown) => Promise.resolve(writeRes).then(res),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  getProfile: async () => null,
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/rate-limit', () => ({ RateLimitedError: class RateLimitedError extends Error {}, enforceRateLimit: vi.fn() }));

import { applyAnalysis } from '@/app/actions/ai';

const R = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';
const A = '7a1c9d2e-5b4f-4a3c-9e8d-1f2a3b4c5d6e';
const ADD = { id: 'a1', type: 'ingredient_add', after: { name: 'Pepe', quantity: 1, unit: 'g' }, reason: 'x' };

describe('applyAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ops.length = 0;
    getUser.mockResolvedValue({ id: 'u1' });
    recipe = {
      id: R, title: 'Pasta', description: null, original_language: 'it', servings: '4', prep_minutes: null, cook_minutes: null, total_minutes: null,
      ingredients: [{ name: 'Sale', quantity: 1, quantityMax: null, unit: 'g', toTaste: false, note: null }], steps: [], category_id: null, tags: ['a'],
      field_flags: {}, content_hash: 'h1', source_url: 'http://s', source_name: 'S', source_attribution: null, verification_status: 'unverified',
    };
    suggestion = { payload: { summary: '', suggestions: [ADD] }, recipe_hash: 'h1' };
    writeRes = { data: { id: 'new-id' }, error: null };
  });

  it('rejects unauthenticated callers and malformed ids', async () => {
    getUser.mockResolvedValue(null);
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'forbidden' });
    getUser.mockResolvedValue({ id: 'u1' });
    expect(await applyAnalysis('x', A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await applyAnalysis(R, 'x', ['a1'], 'apply')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(ops).toHaveLength(0);
  });

  it('validates the selection (non-empty, at most 50)', async () => {
    expect(await applyAnalysis(R, A, [], 'apply')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await applyAnalysis(R, A, Array.from({ length: 51 }, (_, i) => `s${i}`), 'apply')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(ops).toHaveLength(0);
  });

  it('loads the recipe only for its owner and the analysis only for that recipe', async () => {
    await applyAnalysis(R, A, ['a1'], 'apply');
    expect(ops[0]).toMatchObject({ table: 'recipes', eqs: [['id', R], ['owner_id', 'u1']] });
    expect(ops[1]).toMatchObject({ table: 'ai_suggestions', eqs: [['id', A], ['recipe_id', R], ['kind', 'analysis']] });
  });

  it('returns not_found when the recipe (not owned) or the analysis is missing', async () => {
    recipe = null;
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'not_found' });
    recipe = { id: R };
    suggestion = null;
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'not_found' });
    expect(ops.some((o) => o.op !== 'select')).toBe(false);
  });

  it('refuses a stale analysis (recipe changed after it) without writing', async () => {
    suggestion = { payload: { summary: '', suggestions: [ADD] }, recipe_hash: 'old' };
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toEqual({ ok: false, error: 'invalid_input', detail: 'stale' });
    expect(ops.some((o) => o.op !== 'select')).toBe(false);
  });

  it('refuses when none of the selected ids matches a suggestion', async () => {
    expect(await applyAnalysis(R, A, ['nope'], 'apply')).toEqual({ ok: false, error: 'invalid_input', detail: 'stale' });
    expect(ops.some((o) => o.op !== 'select')).toBe(false);
  });

  it("apply mode: updates the owner's recipe with only the selected suggestions and revalidates it", async () => {
    writeRes = { data: [{ id: R }], error: null };
    const res = await applyAnalysis(R, A, ['a1'], 'apply');
    expect(res).toEqual({ ok: true, data: { id: R, applied: 1, skipped: 0 } });
    const upd = ops.find((o) => o.op === 'update')!;
    expect(upd.table).toBe('recipes');
    expect(upd.eqs).toEqual([['id', R], ['owner_id', 'u1'], ['content_hash', 'h1']]);
    expect(upd.payload).toMatchObject({ last_change_source: 'ai_suggestions', last_change_note: '1' });
    expect((upd.payload!.ingredients as { name: string }[]).map((i) => i.name)).toEqual(['Sale', 'Pepe']);
    expect(revalidatePath).toHaveBeenCalledWith(`/recipes/${R}`);
  });

  it('apply mode: returns conflict when the recipe changed meanwhile (no row matched the analysed hash)', async () => {
    writeRes = { data: [], error: null };
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toEqual({ ok: false, error: 'conflict' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('apply mode: propagates update errors without revalidating', async () => {
    writeRes = { error: { code: '42501', message: 'row-level security' } };
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('variant mode: inserts a private linked copy owned by the user and leaves the original alone', async () => {
    const res = await applyAnalysis(R, A, ['a1'], 'variant', '(light)');
    expect(res).toEqual({ ok: true, data: { id: 'new-id', applied: 1, skipped: 0 } });
    expect(ops.some((o) => o.op === 'update')).toBe(false);
    const ins = ops.find((o) => o.op === 'insert')!;
    expect(ins.payload).toMatchObject({
      owner_id: 'u1', title: 'Pasta (light)', visibility: 'private', source_type: 'variant', parent_recipe_id: R, source_url: 'http://s', last_change_source: 'ai_suggestions',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/recipes');
  });

  it('variant mode: caps the title at 200 chars and propagates insert errors', async () => {
    await applyAnalysis(R, A, ['a1'], 'variant', 'x'.repeat(300));
    expect(ops.find((o) => o.op === 'insert')!.payload!.title as string).toHaveLength(200);
    writeRes = { data: null, error: { code: '23514', message: 'check' } };
    expect(await applyAnalysis(R, A, ['a1'], 'variant')).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('maps a corrupt stored payload to a specific error instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    suggestion = { payload: { suggestions: 'bad' }, recipe_hash: 'h1' };
    expect(await applyAnalysis(R, A, ['a1'], 'apply')).toMatchObject({ ok: false, error: 'ai_bad_output' });
  });

  it('filters the suggestion lookup on kind=analysis', async () => {
    await applyAnalysis(R, A, ['a1'], 'apply');
    const q = ops.find((o) => o.table === 'ai_suggestions');
    expect(q?.eqs).toContainEqual(['kind', 'analysis']);
  });
});
