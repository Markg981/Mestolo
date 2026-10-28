import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn(async () => ({ data: true, error: null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { refundQuota } from '@/lib/ai/refund';

const base = { provider: {} as never, providerName: 'App' };

describe('refundQuota con quantita (C-02)', () => {
  beforeEach(() => rpc.mockClear());

  it('1 unita: payload storico senza p_qty', async () => {
    await refundQuota('u1', { ...base, keySource: 'app' }, 'vision', 'extract_photo');
    expect(rpc).toHaveBeenCalledWith('refund_ai_quota', { p_user_id: 'u1', p_group: 'vision', p_action: 'extract_photo' });
  });

  it('8 unita: rimborsa p_qty = 8', async () => {
    await refundQuota('u1', { ...base, keySource: 'app', quantity: 8 }, 'vision', 'extract_photo');
    expect(rpc).toHaveBeenCalledWith('refund_ai_quota', { p_user_id: 'u1', p_group: 'vision', p_action: 'extract_photo', p_qty: 8 });
  });

  it('chiave personale: nessun rimborso', async () => {
    await refundQuota('u1', { ...base, keySource: 'user', quantity: 8 }, 'vision', 'extract_photo');
    expect(rpc).not.toHaveBeenCalled();
  });
});
