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

  it('NON rimborsa se il provider va in timeout prima di paid() (potrebbe aver gia addebitato)', async () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    await expect(
      withRefund('u1', app, group, 'x', async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rimborsa su errore certo prima dell elaborazione', async () => {
    await expect(
      withRefund('u1', app, group, 'x', async () => {
        throw new Error('ECONNREFUSED');
      }),
    ).rejects.toThrow();
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

describe('withRefund: classi di errore', () => {
  beforeEach(() => rpc.mockClear());
  const aiErr = (code: string) => Object.assign(new Error(code), { code });
  const run = (err: unknown) =>
    withRefund('u1', app, group, 'x', async () => {
      throw err;
    }).catch(() => undefined);

  it.each(['invalid_key', 'provider_rate_limited', 'provider_quota', 'provider_error', 'not_configured', 'unsupported', 'keys_unavailable'])(
    'rimborsa AiError %s',
    async (code) => {
      await run(aiErr(code));
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['timeout', 'bad_output', 'quota_exceeded', 'codice_sconosciuto'])('non rimborsa AiError %s', async (code) => {
    await run(aiErr(code));
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['TimeoutError', 'AbortError'])('non rimborsa %s nativo', async (name) => {
    await run(Object.assign(new Error('x'), { name }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rimborsa un errore generico (connessione)', async () => {
    await run(new Error('ECONNREFUSED'));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
