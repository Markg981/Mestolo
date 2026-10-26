import { describe, expect, it, vi } from 'vitest';
import { runCleanupTasks } from './cleanup-runner';

describe('runCleanupTasks', () => {
  it('un task che fallisce non ferma gli altri', async () => {
    const onError = vi.fn();
    const res = await runCleanupTasks(
      [
        { name: 'a', runBatch: vi.fn().mockRejectedValue(new Error('boom')) },
        { name: 'b', runBatch: vi.fn().mockResolvedValue(3) },
      ],
      { budgetMs: 1000, batchSize: 5, onError },
    );
    expect(res[0].error).toBe('boom');
    expect(res[1]).toMatchObject({ processed: 3, done: true });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('processa piu blocchi fino a esaurimento', async () => {
    const runBatch = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const [r] = await runCleanupTasks([{ name: 'a', runBatch }], { budgetMs: 1000, batchSize: 5 });
    expect(r).toMatchObject({ processed: 12, batches: 3, done: true });
  });

  it('rispetta il budget di tempo', async () => {
    let t = 0;
    const runBatch = vi.fn().mockImplementation(async () => {
      t += 400;
      return 5;
    });
    const [r] = await runCleanupTasks([{ name: 'a', runBatch }], {
      budgetMs: 1000,
      batchSize: 5,
      now: () => t,
    });
    expect(r.batches).toBe(3);
    expect(r.done).toBe(false);
  });
});
