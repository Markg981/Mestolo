'use client';

import { useEffect } from 'react';

/** Warms the cook route in the service worker cache (header recognised by public/sw.js) so it works offline. */
export function CookPrefetch({ recipeId }: { recipeId: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || navigator.onLine === false) return;
    fetch(`/recipes/${recipeId}/cook`, { headers: { 'x-mestolo-prefetch': '1' }, credentials: 'same-origin' }).catch(() => {});
  }, [recipeId]);
  return null;
}
