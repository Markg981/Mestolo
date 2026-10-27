import { describe, expect, it, vi, beforeEach } from 'vitest';

const rpc = vi.fn().mockResolvedValue({});
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { withRefund } from './refund';
import type { QuotaGroup, ResolvedProvider } from './service';

const app = { keySource: 'app' } as unknown as ResolvedProvider;
const own = { keySource: 'user' } as unknown as ResolvedProvider;
const group = 'text' as unknown as QuotaGroup;

describe('withRefund', () => {
  beforeEach(() => rpc.mockClear());

  it('rimborsa se il provider va in timeout prima di paid()', async () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    await expect(
      withRefund('u1', app, group, 'x', async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(rpc).toHaveBeenCalledWith('refund_ai_quota', { p_user_id: 'u1', p_group: 'text', p_action: 'x' });
  });

  it('non rimborsa dopo paid()', async () => {
    await expect(
      withRefund('u1', app, group, 'x', async (paid) => {
        paid();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('non rimborsa con chiave personale', async () => {
    await expect(
      withRefund('u1', own, group, 'x', async () => {
        throw new Error('t');
      }),
    ).rejects.toThrow('t');
    expect(rpc).not.toHaveBeenCalled();
  });
});
