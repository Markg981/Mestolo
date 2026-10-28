import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.fn();
const result = vi.fn();

vi.mock('@/lib/env', () => ({ env: () => env() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ limit: () => ({ abortSignal: () => result() }) }) }),
  }),
}));

let GET: () => Promise<Response>;

describe('GET /api/health', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules(); // azzera la cache in memoria del modulo
    ({ GET } = await import('@/app/api/health/route'));
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

  it('riusa l esito del DB entro il TTL senza rifare la query', async () => {
    vi.useFakeTimers();
    result.mockResolvedValue({ error: null });
    await GET();
    await GET();
    await GET();
    expect(result).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    await GET();
    expect(result).toHaveBeenCalledTimes(2);
  });

  it('richieste concorrenti condividono un solo ping', async () => {
    result.mockResolvedValue({ error: null });
    await Promise.all([GET(), GET(), GET()]);
    expect(result).toHaveBeenCalledTimes(1);
  });

  it('un errore DB viene rivalutato dopo pochi secondi', async () => {
    vi.useFakeTimers();
    result.mockResolvedValueOnce({ error: { message: 'boom' } }).mockResolvedValue({ error: null });
    expect((await GET()).status).toBe(503);
    expect((await GET()).status).toBe(503);
    expect(result).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await GET()).status).toBe(200);
  });
});
