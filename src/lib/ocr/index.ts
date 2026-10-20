'use client';

import { Capacitor } from '@capacitor/core';
import { recognizeNative } from './native';
import { recognizeWithTesseract } from './tesseract';

/** On-device OCR of one page: ML Kit in the native app, Tesseract.js elsewhere (and as fallback). */
export async function recognizePage(blob: Blob, locale: string, onProgress?: (p: number) => void): Promise<string> {
  let native = false;
  try {
    native = Capacitor.isNativePlatform();
  } catch {
    native = false;
  }
  if (native) {
    try {
      return await recognizeNative(blob);
    } catch {
      // plugin unavailable or failed: fall back to Tesseract
    }
  }
  return recognizeWithTesseract(blob, locale, onProgress);
}
