/** Singolo elemento fallito: identificativo leggibile, codice motivo e l'elemento stesso (per il retry). */
export type BulkFailure<T> = { label: string; reason: string; item: T };

export type BulkProgress<T = unknown> = {
  done: number;
  created: number;
  duplicates: number;
  failed: number;
  stopped: boolean;
  failures: BulkFailure<T>[];
};

/** Esito del salvataggio: in caso di errore `reason` e' il codice errore (mappato a testo dalla UI). */
export type SaveResult = { ok: true } | { ok: false; reason: string };

type Deps<T> = {
  isDuplicate: (item: T) => Promise<boolean>;
  save: (item: T) => Promise<SaveResult>;
  /** Identificativo mostrato all'utente (titolo, URL, nome file...). */
  label: (item: T) => string;
  onProgress: (p: BulkProgress<T>) => void;
  shouldStop: () => boolean;
};

/**
 * Imports items one by one. Stops cleanly between items when shouldStop() is true; items already
 * saved are detected as duplicates on a later run, so an interrupted import can simply be resumed.
 * Ogni fallimento viene raccolto con identificativo e motivo, cosi' la UI puo' elencarli e rilanciarli.
 */
export async function runBulkImport<T>(items: T[], d: Deps<T>): Promise<BulkProgress<T>> {
  const p: BulkProgress<T> = { done: 0, created: 0, duplicates: 0, failed: 0, stopped: false, failures: [] };
  const fail = (item: T, reason: string) => {
    p.failed++;
    p.failures.push({ label: d.label(item), reason, item });
  };
  for (const item of items) {
    if (d.shouldStop()) {
      p.stopped = true;
      break;
    }
    try {
      if (await d.isDuplicate(item)) p.duplicates++;
      else {
        const r = await d.save(item);
        if (r.ok) p.created++;
        else fail(item, r.reason);
      }
    } catch {
      fail(item, 'unexpected');
    }
    p.done++;
    d.onProgress({ ...p, failures: [...p.failures] });
  }
  d.onProgress({ ...p, failures: [...p.failures] });
  return p;
}
