import { describe, expect, it, vi } from 'vitest';
import { OcrTimeoutError, withTimeout } from '@/lib/ocr/timeout';

describe('withTimeout', () => {
  it('returns the result when the task is fast enough', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('rejects with OcrTimeoutError when the task hangs', async () => {
    vi.useFakeTimers();
    try {
      const assertion = expect(withTimeout(new Promise<string>(() => {}), 1000)).rejects.toBeInstanceOf(OcrTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates the task error unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});
