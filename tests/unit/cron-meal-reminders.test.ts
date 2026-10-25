import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn<(endpoint: unknown, payload: unknown, options?: unknown) => Promise<unknown>>();
const setVapidDetails = vi.fn();
vi.mock('web-push', () => ({ default: { sendNotification: (e: unknown, p: unknown, o?: unknown) => sendNotification(e, p, o), setVapidDetails: (...a: unknown[]) => setVapidDetails(...a) } }));

const deleted: string[][] = [];
const rpc = vi.fn(async () => ({
  data: [{ entry_id: 'e1', user_id: 'u1', slot: 'dinner', title: 'Risotto ai funghi', locale: 'it' }],
  error: null,
}));
const subs = [
  { id: 's1', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'p', auth: 'a' },
  { id: 's2', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/2', p256dh: 'p', auth: 'a' },
];
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      select: () => ({ in: async () => ({ data: subs, error: null }) }),
      delete: () => ({ in: async (_c: string, ids: string[]) => (deleted.push(ids), { error: null }) }),
    }),
  }),
}));

import { GET } from '@/app/api/cron/meal-reminders/route';

const req = (auth?: string) => new Request('http://localhost/api/cron/meal-reminders', { headers: auth ? { authorization: auth } : {} });

describe('GET /api/cron/meal-reminders', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'topsecret');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.com');
    rpc.mockClear();
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    deleted.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects missing or wrong credentials without touching the database', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('rejects everything when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(req('Bearer '))).status).toBe(401);
    expect((await GET(req('Bearer undefined'))).status).toBe(401);
  });

  it('does nothing (and claims nothing) when VAPID keys are missing', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    const res = await GET(req('Bearer topsecret'));
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'vapid_not_configured' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends a localized notification to every subscription of the user', async () => {
    const res = await GET(req('Bearer topsecret'));
    expect(await res.json()).toMatchObject({ ok: true, meals: 1, sent: 2, removed: 0 });
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:admin@example.com', 'pub', 'priv');
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload).toMatchObject({ title: 'Mestolo', body: 'Stasera: Risotto ai funghi', url: '/plan' });
  });

  it('deletes subscriptions answering 404/410 and keeps going on other errors', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 })).mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    const res = await GET(req('Bearer topsecret'));
    expect(await res.json()).toMatchObject({ sent: 0, removed: 1 });
    expect(deleted).toEqual([['s1']]);
  });

  const confirmCalls = () => rpc.mock.calls.filter((c) => (c as unknown[])[0] === 'confirm_meal_reminders');

  it('confirms the reminder only after a successful push', async () => {
    await GET(req('Bearer topsecret'));
    expect(confirmCalls()).toEqual([['confirm_meal_reminders', { p_entry_ids: ['e1'] }]]);
  });

  it('does not confirm when every push fails transiently, so the claim can be retried', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 503 }));
    const res = await GET(req('Bearer topsecret'));
    expect(await res.json()).toMatchObject({ sent: 0, confirmed: 0 });
    expect(confirmCalls()).toHaveLength(0);
  });

  it('confirms when at least one subscription received the push, or when all are permanently gone', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    await GET(req('Bearer topsecret'));
    expect(confirmCalls()).toHaveLength(1);
    rpc.mockClear();
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    await GET(req('Bearer topsecret'));
    expect(confirmCalls()).toHaveLength(1);
  });

  it('removes subscriptions with a non-allowlisted endpoint without contacting them', async () => {
    subs.push({ id: 's3', user_id: 'u1', endpoint: 'https://169.254.169.254/latest', p256dh: 'p', auth: 'a' });
    const res = await GET(req('Bearer topsecret'));
    expect(await res.json()).toMatchObject({ sent: 2, removed: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual([['s3']]);
  });
});
