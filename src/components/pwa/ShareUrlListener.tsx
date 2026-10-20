'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { appUrlToPath } from '@/lib/import/share-url';

/** In the native app, routes `mestolo://share?...` links (iOS Share Extension) to the import flow. */
export function ShareUrlListener() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appUrlOpen', ({ url }) => {
          const path = appUrlToPath(url);
          if (path) window.location.assign(path);
        }),
      )
      .then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
  return null;
}
