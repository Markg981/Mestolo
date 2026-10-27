/** Web OCR adapter (tesseract.js) and the native/web switch, with the engines mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const t = vi.hoisted(() => ({ createWorker: vi.fn(), recognize: vi.fn(), terminate: vi.fn() }));
const n = vi.hoisted(() => ({ native: false, recognizeNative: vi.fn() }));

vi.mock('tesseract.js', () => ({ createWorker: t.createWorker }));
vi.mock('@/lib/ocr/image', () => ({ decodeToCanvas: vi.fn(async () => 'CANVAS') }));
vi.mock('@/lib/ocr/native', () => ({ recognizeNative: n.recognizeNative }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => n.native } }));

import { recognizeWithTesseract, TESSERACT_LANG } from '@/lib/ocr/tesseract';
import { recognizePage } from '@/lib/ocr';
import { OCR_PAGE_TIMEOUT_MS, OcrTimeoutError } from '@/lib/ocr/timeout';
import { decodeToCanvas } from '@/lib/ocr/image';

type Logger = (m: { status: string; progress: number }) => void;
const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const tline = (text: string, b: ReturnType<typeof bbox>) => ({ text, bbox: b, words: text.split(' ').map((w, i) => ({ text: w, bbox: bbox(b.x0 + i * 60, b.y0, b.x0 + i * 60 + 50, b.y1) })) });

describe('recognizeWithTesseract', () => {
  let logger: Logger | undefined;
  beforeEach(() => {
    t.terminate.mockResolvedValue(undefined);
    t.createWorker.mockImplementation(async (_lang: string, _oem: number, opts: { logger?: Logger }) => {
      logger = opts.logger;
      return { recognize: t.recognize, terminate: t.terminate };
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('loads worker, core and language data from the same origin, never from a CDN', async () => {
    t.recognize.mockResolvedValue({ data: { text: 'x', blocks: [] } });
    await recognizeWithTesseract(new Blob(['x']), 'it');
    expect(t.createWorker).toHaveBeenCalledWith('ita', 1, expect.objectContaining({ workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', workerBlobURL: false }));
    expect(decodeToCanvas).toHaveBeenCalledWith(expect.any(Blob), 2200);
    expect(t.recognize).toHaveBeenCalledWith('CANVAS', {}, { text: true, blocks: true });
  });

  it.each(Object.entries(TESSERACT_LANG))('maps locale %s to %s', async (locale, lang) => {
    t.recognize.mockResolvedValue({ data: { text: '', blocks: [] } });
    await recognizeWithTesseract(new Blob(['x']), locale);
    expect(t.createWorker.mock.calls[0][0]).toBe(lang);
  });

  it('falls back to English for an unknown locale', async () => {
    t.recognize.mockResolvedValue({ data: { text: '', blocks: [] } });
    await recognizeWithTesseract(new Blob(['x']), 'ja');
    expect(t.createWorker.mock.calls[0][0]).toBe('eng');
  });

  it('reports only recognition progress', async () => {
    const progress = vi.fn();
    t.recognize.mockImplementation(async () => {
      logger?.({ status: 'loading language traineddata', progress: 0.5 });
      logger?.({ status: 'recognizing text', progress: 0.4 });
      logger?.({ status: 'recognizing text', progress: 1 });
      return { data: { text: '', blocks: [] } };
    });
    await recognizeWithTesseract(new Blob(['x']), 'it', progress);
    expect(progress.mock.calls).toEqual([[0.4], [1]]);
  });

  it('rebuilds two columns from the line boxes', async () => {
    t.recognize.mockResolvedValue({
      data: {
        text: 'raw',
        blocks: [
          { paragraphs: [{ lines: [tline('Procedimento', bbox(600, 100, 900, 130)), tline('Impastare bene', bbox(600, 140, 950, 170))] }] },
          { paragraphs: [{ lines: [tline('Ingredienti', bbox(50, 100, 300, 130)), tline('300 g farina', bbox(50, 140, 320, 170))] }] },
        ],
      },
    });
    const text = await recognizeWithTesseract(new Blob(['x']), 'it');
    expect(text.indexOf('300 g farina')).toBeLessThan(text.indexOf('Procedimento'));
  });

  it('returns the plain text when there are no blocks', async () => {
    t.recognize.mockResolvedValue({ data: { text: 'solo testo', blocks: null } });
    await expect(recognizeWithTesseract(new Blob(['x']), 'it')).resolves.toBe('solo testo');
  });

  it('terminates the worker after success and after failure', async () => {
    t.recognize.mockResolvedValueOnce({ data: { text: '', blocks: [] } });
    await recognizeWithTesseract(new Blob(['x']), 'it');
    t.recognize.mockRejectedValueOnce(new Error('wasm'));
    await expect(recognizeWithTesseract(new Blob(['x']), 'it')).rejects.toThrow('wasm');
    expect(t.terminate).toHaveBeenCalledTimes(2);
  });

  it('terminates a worker whose creation finishes after the timeout', async () => {
    vi.useFakeTimers();
    try {
      let resolveWorker!: (w: unknown) => void;
      t.createWorker.mockImplementation(() => new Promise((r) => { resolveWorker = r; }));
      const res = expect(recognizeWithTesseract(new Blob(['x']), 'it')).rejects.toBeInstanceOf(OcrTimeoutError);
      await vi.advanceTimersByTimeAsync(OCR_PAGE_TIMEOUT_MS);
      await res;
      expect(t.terminate).not.toHaveBeenCalled();
      resolveWorker({ recognize: t.recognize, terminate: t.terminate });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out a stuck page and terminates the worker', async () => {
    vi.useFakeTimers();
    try {
      t.recognize.mockReturnValue(new Promise(() => {}));
      const res = expect(recognizeWithTesseract(new Blob(['x']), 'it')).rejects.toBeInstanceOf(OcrTimeoutError);
      await vi.advanceTimersByTimeAsync(OCR_PAGE_TIMEOUT_MS);
      await res;
      expect(t.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recognizePage', () => {
  beforeEach(() => {
    t.createWorker.mockResolvedValue({ recognize: t.recognize, terminate: t.terminate.mockResolvedValue(undefined) });
    t.recognize.mockResolvedValue({ data: { text: 'web', blocks: [] } });
  });
  afterEach(() => {
    n.native = false;
    vi.clearAllMocks();
  });

  it('uses Tesseract on the web', async () => {
    await expect(recognizePage(new Blob(['x']), 'it')).resolves.toBe('web');
    expect(n.recognizeNative).not.toHaveBeenCalled();
  });

  it('uses ML Kit in the native app', async () => {
    n.native = true;
    n.recognizeNative.mockResolvedValue('native');
    await expect(recognizePage(new Blob(['x']), 'it')).resolves.toBe('native');
    expect(t.createWorker).not.toHaveBeenCalled();
  });

  it('falls back to Tesseract when ML Kit fails', async () => {
    n.native = true;
    n.recognizeNative.mockRejectedValue(new Error('ocr_native_unavailable'));
    await expect(recognizePage(new Blob(['x']), 'it')).resolves.toBe('web');
  });
});
