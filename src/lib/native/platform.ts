'use client';

import { Capacitor } from '@capacitor/core';

export type AppPlatform = 'web' | 'android' | 'ios';

/** Capacitor platform of the running shell; "web" in the browser or if detection fails. */
export function getAppPlatform(): AppPlatform {
  try {
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    return 'web';
  }
}
