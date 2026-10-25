/** Raised when a page takes too long to read on-device. */
export class OcrTimeoutError extends Error {
  constructor(ms: number) {
    super(`OCR timeout after ${ms}ms`);
    this.name = 'OcrTimeoutError';
  }
}

/** Per-page recognition budget (Tesseract on a slow phone can be slow, but never endless). */
export const OCR_PAGE_TIMEOUT_MS = 90_000;

/** Rejects with OcrTimeoutError if `task` does not settle within `ms`; the timer is always cleared. */
export async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError(ms)), ms);
  });
  // The loser of the race may reject later (e.g. worker terminated): avoid an unhandled rejection
  task.catch(() => {});
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
