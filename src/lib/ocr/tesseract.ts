'use client';

import { decodeToCanvas } from './image';

/** Tesseract language codes for the app locales; data is self-hosted in public/ocr/lang. */
export const TESSERACT_LANG: Record<string, string> = { it: 'ita', en: 'eng', de: 'deu', fr: 'fra', es: 'spa', pt: 'por' };

/** Web OCR: tesseract.js is imported only when needed; worker, core and data come from /ocr (same origin). */
export async function recognizeWithTesseract(blob: Blob, locale: string, onProgress?: (p: number) => void): Promise<string> {
  const lang = TESSERACT_LANG[locale] ?? 'eng';
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(lang, 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const canvas = await decodeToCanvas(blob, 2200);
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
