export type BulkProgress = { done: number; created: number; duplicates: number; failed: number; stopped: boolean };

type Deps<T> = {
  isDuplicate: (item: T) => Promise<boolean>;
  save: (item: T) => Promise<boolean>;
  onProgress: (p: BulkProgress) => void;
  shouldStop: () => boolean;
};

/**
 * Imports items one by one. Stops cleanly between items when shouldStop() is true; items already
 * saved are detected as duplicates on a later run, so an interrupted import can simply be resumed.
 */
export async function runBulkImport<T>(items: T[], d: Deps<T>): Promise<BulkProgress> {
  const p: BulkProgress = { done: 0, created: 0, duplicates: 0, failed: 0, stopped: false };
  for (const item of items) {
    if (d.shouldStop()) {
      p.stopped = true;
      break;
    }
    try {
      if (await d.isDuplicate(item)) p.duplicates++;
      else if (await d.save(item)) p.created++;
      else p.failed++;
    } catch {
      p.failed++;
    }
    p.done++;
    d.onProgress({ ...p });
  }
  d.onProgress({ ...p });
  return p;
}
