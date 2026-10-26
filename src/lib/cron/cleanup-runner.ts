export const CLEANUP_BATCH = 200;

export type CleanupTask = {
  name: string;
  /** Elabora al massimo `limit` elementi e ritorna quanti ne ha trattati (< limit = finito). */
  runBatch: (limit: number) => Promise<number>;
};

export type CleanupTaskResult = {
  name: string;
  processed: number;
  batches: number;
  done: boolean;
  error?: string;
};

type Options = {
  budgetMs: number;
  batchSize?: number;
  now?: () => number;
  onError?: (task: string, error: unknown) => void;
};

/**
 * Esegue ogni task in modo indipendente: un errore viene raccolto e gli altri task proseguono.
 * Ogni task cicla a blocchi finche' non finisce o il budget di tempo e' esaurito.
 */
export async function runCleanupTasks(
  tasks: CleanupTask[],
  { budgetMs, batchSize = CLEANUP_BATCH, now = Date.now, onError }: Options,
): Promise<CleanupTaskResult[]> {
  const deadline = now() + budgetMs;
  const results: CleanupTaskResult[] = [];
  for (const task of tasks) {
    const result: CleanupTaskResult = { name: task.name, processed: 0, batches: 0, done: false };
    try {
      while (now() < deadline) {
        const n = await task.runBatch(batchSize);
        result.batches += 1;
        result.processed += n;
        if (n < batchSize) {
          result.done = true;
          break;
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      onError?.(task.name, error);
    }
    results.push(result);
  }
  return results;
}
