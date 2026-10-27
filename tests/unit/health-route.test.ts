import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.fn();
const result = vi.fn();

vi.mock('@/lib/env', () => ({ env: () => env() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ limit: () => ({ abortSignal: () => result() }) }) }),
  }),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    env.mockReturnValue({ supabaseUrl: 'http://x', serviceRoleKey: 'k' });
  });
  afterEach(() => vi.useRealTimers());

  it('200 ok', async () => {
    result.mockResolvedValue({ error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('503 se la configurazione e KO, senza esporre dettagli', async () => {
    env.mockImplementation(() => {
      throw new Error('Missing required environment variables: SECRET_X');
    });
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toBe('{"status":"error","checks":{"config":false,"db":false}}');
    expect(text).not.toContain('SECRET_X');
  });

  it('503 se il DB risponde con errore', async () => {
    result.mockResolvedValue({ error: { message: 'boom' } });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', checks: { config: true, db: false } });
  });

  it('503 su timeout del DB', async () => {
    vi.useFakeTimers();
    result.mockReturnValue(new Promise(() => {}));
    const p = GET();
    await vi.advanceTimersByTimeAsync(3100);
    const res = await p;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', checks: { config: true, db: false } });
  });
});
