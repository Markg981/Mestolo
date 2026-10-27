import { describe, expect, it } from 'vitest';
import { runBulkImport } from '@/lib/recipes/bulk-import';

const noop = () => {};

describe('runBulkImport', () => {
  it('counts created, duplicates and failures, collecting per-item reasons', async () => {
    const p = await runBulkImport(['a', 'dup', 'bad', 'boom'], {
      label: (i) => `ricetta ${i}`,
      isDuplicate: async (i) => i === 'dup',
      save: async (i) => {
        if (i === 'boom') throw new Error('x');
        return i === 'bad' ? { ok: false, reason: 'rate_limited' } : { ok: true };
      },
      onProgress: noop,
      shouldStop: () => false,
    });
    expect(p).toMatchObject({ done: 4, created: 1, duplicates: 1, failed: 2, stopped: false });
    // I falliti conservano etichetta, motivo e l'elemento (per "Riprova i falliti")
    expect(p.failures).toEqual([
      { label: 'ricetta bad', reason: 'rate_limited', item: 'bad' },
      { label: 'ricetta boom', reason: 'unexpected', item: 'boom' },
    ]);
  });

  it('duplicates are not failures', async () => {
    const p = await runBulkImport(['d'], { label: (i) => i, isDuplicate: async () => true, save: async () => ({ ok: true }), onProgress: noop, shouldStop: () => false });
    expect(p.failures).toEqual([]);
  });

  it('stops between items and reports how many were saved', async () => {
    let stop = false;
    const p = await runBulkImport([1, 2, 3, 4], {
      label: String,
      isDuplicate: async () => false,
      save: async (i) => {
        if (i === 2) stop = true;
        return { ok: true };
      },
      onProgress: noop,
      shouldStop: () => stop,
    });
    expect(p).toMatchObject({ done: 2, created: 2, stopped: true });
  });
});
