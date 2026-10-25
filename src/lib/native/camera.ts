'use client';

import { Capacitor } from '@capacitor/core';

/** True only inside the Android/iOS app (Capacitor shell), false on the web. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Camera');
  } catch {
    return false;
  }
}

/**
 * Takes a photo with the native camera. Returns null if the user cancels.
 * DataUrl is used (not a file URI) because the app loads the remote site,
 * which cannot fetch local capacitor:// file URLs.
 */
export async function takeNativePhoto(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.DataUrl,
      quality: 85,
      width: 2000,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.dataUrl) return null;
    const blob = dataUrlToBlob(photo.dataUrl);
    return new File([blob], `page-${Date.now()}.${photo.format || 'jpg'}`, { type: blob.type || 'image/jpeg' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw e;
  }
}

/** Decodes a base64 data URL in memory: fetch() on data: URLs is blocked by the CSP connect-src. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
