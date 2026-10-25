'use client';

import { decodeToCanvas } from './image';
import { linesToText } from './layout';
import { OCR_PAGE_TIMEOUT_MS, withTimeout } from './timeout';

/** Tesseract language codes for the app locales; data is self-hosted in public/ocr/lang. */
export const TESSERACT_LANG: Record<string, string> = { it: 'ita', en: 'eng', de: 'deu', fr: 'fra', es: 'spa', pt: 'por' };

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;

/** Web OCR: tesseract.js is imported only when needed; worker, core and data come from /ocr (same origin). */
export async function recognizeWithTesseract(blob: Blob, locale: string, onProgress?: (p: number) => void): Promise<string> {
  let worker: TesseractWorker | undefined;

  async function run(): Promise<string> {
    const lang = TESSERACT_LANG[locale] ?? 'eng';
    const { createWorker } = await import('tesseract.js');
    const w = await createWorker(lang, 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress);
      },
    });
    worker = w;
    const canvas = await decodeToCanvas(blob, 2200);
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    if (!lines.length) return data.text;
    return linesToText(
      lines.map(({ text, bbox: b, words }) => ({
        text,
        x: b.x0,
        y: b.y0,
        w: b.x1 - b.x0,
        h: b.y1 - b.y0,
        words: words?.map((w) => ({ text: w.text, x: w.bbox.x0, w: w.bbox.x1 - w.bbox.x0 })),
      })),
    );
  }

  try {
    return await withTimeout(run(), OCR_PAGE_TIMEOUT_MS);
  } finally {
    // Also stops a stuck recognition after a timeout
    await worker?.terminate().catch(() => {});
  }
}
