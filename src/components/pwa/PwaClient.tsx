'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';

/** Registers the service worker (production only, secure contexts only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}

/** Deletes cached private pages/images (called on logout and before login). */
export async function clearUserCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-user-data' });
    if ('caches' in window) await caches.delete('mestolo-user');
  } catch {
    /* nothing cached */
  }
}

/** Clears the private cache when mounted (used on the login page). */
export function ClearUserCacheOnMount() {
  useEffect(() => {
    clearUserCache();
  }, []);
  return null;
}

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function OfflineBanner() {
  const t = useTranslations('offline');
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="no-print sticky top-0 z-40 flex items-center gap-2 bg-ink px-4 py-2 text-sm text-porcelain">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      {t('banner')}
    </div>
  );
}

/** Logout button that wipes the offline copy of private pages before signing out. */
export function SignOutButton({ action, label, className }: { action: () => Promise<void>; label: string; className?: string }) {
  return (
    <form
      action={action}
      onSubmit={() => {
        clearUserCache();
      }}
    >
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
