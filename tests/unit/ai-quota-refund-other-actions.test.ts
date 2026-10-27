import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getProfile: vi.fn(),
  createClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveProvider: vi.fn(),
  recordUsage: vi.fn(),
  refundRpc: vi.fn(),
  completeJson: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ getUser: mocks.getUser, getProfile: mocks.getProfile, createClient: mocks.createClient }));
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/ai/service', () => ({ resolveProvider: mocks.resolveProvider, recordUsage: mocks.recordUsage }));
// withRefund resta reale: si osserva solo la RPC di rimborso sul client admin.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.refundRpc }) }));

import { askCookAssistant } from '@/app/actions/cook-assistant';

const RID = '11111111-1111-4111-8111-111111111111';

describe('cook assistant: quota AI e rimborso', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ id: 'u1' });
    mocks.getProfile.mockResolvedValue({ locale: 'it' });
    mocks.createClient.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: 't', ingredients: [], steps: [], servings: null } }) }) }) }),
    });
    mocks.resolveProvider.mockResolvedValue({ provider: { completeJson: mocks.completeJson }, keySource: 'app', providerName: 'x' });
  });

  it('successo -> nessun rimborso, uso registrato', async () => {
    mocks.completeJson.mockResolvedValue({ answer: 'ok' });
    const r = await askCookAssistant(RID, { question: 'q', stepIndex: 0 });
    expect(r.ok).toBe(true);
    expect(mocks.refundRpc).not.toHaveBeenCalled();
    expect(mocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('rate limit superato -> la quota non viene consumata', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error('rate_limited'));
    const r = await askCookAssistant(RID, { question: 'q', stepIndex: 0 });
    expect(r.ok).toBe(false);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });
});

// I casi di rimborso (provider in errore, output non valido) di tutte le azioni AI sono in ai-quota-refund.test.ts.
