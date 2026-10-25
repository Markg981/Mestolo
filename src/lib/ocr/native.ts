'use client';

import type { TextLine } from '@capacitor-mlkit/text-recognition';
import { linesToText, type OcrLine } from './layout';

/**
 * Native OCR (Google ML Kit). ML Kit reads a local file path, so the already-downscaled
 * image is written to the app cache first. Throws if the plugin is missing from the native
 * build: the caller then falls back to Tesseract.
 */
export async function recognizeNative(blob: Blob): Promise<string> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('TextRecognition')) throw new Error('ocr_native_unavailable');
  const [{ Filesystem, Directory }, { TextRecognition }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor-mlkit/text-recognition')]);
  const data = await blobToBase64(blob);
  const file = await Filesystem.writeFile({ path: `ocr-${Date.now()}.jpg`, data, directory: Directory.Cache });
  try {
    const res = await TextRecognition.processImage({ path: file.uri });
    const lines = res.blocks.flatMap((b) => b.lines);
    // ML Kit's block order mixes columns: rebuild it from geometry when every line has a box.
    return lines.length && lines.every((l) => l.boundingBox) ? linesToText(lines.map(toOcrLine)) : res.text;
  } finally {
    await Filesystem.deleteFile({ path: file.uri }).catch(() => undefined);
  }
}

function toOcrLine(l: TextLine): OcrLine {
  const r = l.boundingBox!;
  const [p0, p1] = l.cornerPoints ?? [];
  const angle = p0 && p1 && p1.x !== p0.x ? Math.atan2(p1.y - p0.y, p1.x - p0.x) : undefined;
  const words = l.elements?.flatMap((e) => (e.boundingBox ? [{ text: e.text, x: e.boundingBox.left, w: e.boundingBox.right - e.boundingBox.left }] : []));
  return { text: l.text, x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, angle, words };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
