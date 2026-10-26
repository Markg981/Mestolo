import { describe, expect, it } from 'vitest';
import { runBulkImport } from '@/lib/recipes/bulk-import';

const noop = () => {};

describe('runBulkImport', () => {
  it('counts created, duplicates and failures', async () => {
    const p = await runBulkImport(['a', 'dup', 'bad', 'boom'], {
      isDuplicate: async (i) => i === 'dup',
      save: async (i) => {
        if (i === 'boom') throw new Error('x');
        return i !== 'bad';
      },
      onProgress: noop,
      shouldStop: () => false,
    });
    expect(p).toEqual({ done: 4, created: 1, duplicates: 1, failed: 2, stopped: false });
  });

  it('stops between items and reports how many were saved', async () => {
    let stop = false;
    const p = await runBulkImport([1, 2, 3, 4], {
      isDuplicate: async () => false,
      save: async (i) => {
        if (i === 2) stop = true;
        return true;
      },
      onProgress: noop,
      shouldStop: () => stop,
    });
    expect(p).toMatchObject({ done: 2, created: 2, stopped: true });
  });
});
