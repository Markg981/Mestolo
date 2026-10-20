'use client';

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
    return res.text;
  } finally {
    await Filesystem.deleteFile({ path: file.uri }).catch(() => undefined);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
