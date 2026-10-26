import { beforeEach, describe, expect, it, vi } from 'vitest';

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';
const USER = { id: '22222222-2222-4222-8222-222222222222' };
const recipe = {
  id: RECIPE_ID,
  owner_id: USER.id,
  title: 'Pasta',
  description: '',
  original_language: 'it',
  servings: 2,
  prep_minutes: 5,
  cook_minutes: 10,
  total_minutes: 15,
  ingredients: [{ name: 'pasta', quantity: '200', unit: 'g', note: null, section: null }],
  steps: [{ text: 'Cuoci', section: null }],
  category_id: null,
  tags: [],
  content_hash: 'h1',
  public_slug: null,
  field_flags: {},
};

const { processImage } = vi.hoisted(() => ({ processImage: vi.fn() }));
const rpc = vi.fn();
const completeJson = vi.fn();
const generateImage = vi.fn();
let refundFails = false;

// Catena Supabase generica: ogni metodo restituisce la catena, single/maybeSingle danno la ricetta.
function chain(single: unknown = recipe) {
  const c: Record<string, unknown> = {};
  const self = new Proxy(c, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: null, error: null, count: 0 });
      if (prop === 'maybeSingle') return async () => ({ data: single, error: null });
      if (prop === 'single') return async () => ({ data: { id: 'new-id' }, error: null });
      return () => self;
    },
  });
  return self;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), enforceRateLimit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => USER,
  getProfile: async () => ({ locale: 'it' }),
  createClient: async () => ({ from: () => chain() }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => {
      rpc(...a);
      if (refundFails) throw new Error('rpc down');
      return Promise.resolve({ data: null, error: null });
    },
    from: () => chain(),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
  }),
}));
vi.mock('@/lib/ai/service', () => ({
  resolveProvider: async () => ({ provider: { id: 'app', completeJson, generateImage }, keySource: 'app', providerName: 'App' }),
  recordUsage: vi.fn(async () => {}),
}));
vi.mock('@/lib/images/process', () => ({
  ImageValidationError: class ImageValidationError extends Error {},
  processRecipeImage: (...a: unknown[]) => processImage(...a),
}));
vi.mock('@/lib/images/quota', () => ({ userOverImageQuota: async () => false }));

import { analyzeRecipe, suggestSubstitutions, translateRecipe } from '@/app/actions/ai';
import { askCookAssistant } from '@/app/actions/cook-assistant';
import { estimateNutrition } from '@/app/actions/nutrition';
import { generateRecipeImage } from '@/app/actions/images';

const refund = (group: string, action: string) => ['refund_ai_quota', { p_user_id: USER.id, p_group: group, p_action: action }];

const cases = [
  {
    name: 'recipe analysis',
    run: () => analyzeRecipe(RECIPE_ID),
    refund: refund('text', 'analyze'),
    bad: { suggestions: 'nope' },
    good: { summary: 'ok', suggestions: [] },
    badError: 'ai_bad_output',
  },
  {
    name: 'substitutions',
    run: () => suggestSubstitutions(RECIPE_ID, ['burro'], true),
    refund: refund('text', 'substitute'),
    bad: { ingredients: 'nope' },
    good: { ingredients: [] },
    badError: 'ai_bad_output',
  },
  {
    name: 'translation',
    run: () => translateRecipe(RECIPE_ID, 'en'),
    refund: refund('translate', 'recipe'),
    bad: { title: 1 },
    good: { title: 'Pasta', description: '', ingredients: [{ name: 'pasta', note: null }], steps: [{ text: 'Cook' }] },
    badError: 'translation_failed',
  },
  {
    name: 'cook assistant',
    run: () => askCookAssistant(RECIPE_ID, { stepIndex: 0, servings: 2, history: [], question: 'quanto?' } as never),
    refund: refund('text', 'cook_assist'),
    bad: { answer: '' },
    good: { answer: 'Dieci minuti' },
    badError: 'ai_bad_output',
  },
  {
    name: 'nutrition',
    run: () => estimateNutrition(RECIPE_ID),
    refund: refund('text', 'nutrition'),
    bad: { unrelated: true },
    good: { energy_kcal: 300 },
    badError: 'ai_bad_output',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  refundFails = false;
  processImage.mockResolvedValue({ full: Buffer.from('a'), thumb: Buffer.from('b'), width: 1, height: 1 });
});

describe.each(cases)('$name: quota refund', (c) => {
  it('refunds when the provider throws', async () => {
    completeJson.mockRejectedValue(new Error('upstream 503'));
    const res = await c.run();
    expect(res.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(...c.refund);
  });

  it('refunds when the output is invalid', async () => {
    completeJson.mockResolvedValue(c.bad);
    const res = await c.run();
    expect(res).toMatchObject({ ok: false, error: c.badError });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(...c.refund);
  });

  it('keeps the original error when the refund itself fails', async () => {
    refundFails = true;
    completeJson.mockResolvedValue(c.bad);
    const res = await c.run();
    expect(res).toMatchObject({ ok: false, error: c.badError });
  });

  it('does not refund on success', async () => {
    completeJson.mockResolvedValue(c.good);
    const res = await c.run();
    expect(res.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('image generation: quota refund', () => {
  it('refunds when the provider throws', async () => {
    generateImage.mockRejectedValue(new Error('timeout'));
    const res = await generateRecipeImage(RECIPE_ID, true);
    expect(res.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(...refund('image', 'generate'));
  });

  it('refunds when the generated image is unusable', async () => {
    const { ImageValidationError } = await import('@/lib/images/process');
    generateImage.mockResolvedValue({ base64: 'AAAA' });
    processImage.mockRejectedValue(new ImageValidationError('invalid_input' as never));
    const res = await generateRecipeImage(RECIPE_ID, true);
    expect(res).toMatchObject({ ok: false, error: 'ai_bad_output' });
    expect(rpc).toHaveBeenCalledWith(...refund('image', 'generate'));
  });

  it('does not refund on success', async () => {
    generateImage.mockResolvedValue({ base64: 'AAAA' });
    const res = await generateRecipeImage(RECIPE_ID, true);
    expect(res.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
