'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';
import { clearAllDrafts, clearOtherUsersDrafts } from '@/lib/drafts';

/** Registers the service worker (production only, secure contexts only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}

/**
 * Deletes cached private pages/images (called on logout and before login).
 * Before login the drafts are kept: they are keyed by user id, and a session that
 * expired mid-edit must not cost the draft (other users' drafts go after login).
 */
export async function clearUserCache({ keepDrafts = false }: { keepDrafts?: boolean } = {}) {
  if (!keepDrafts) clearAllDrafts();
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-user-data' });
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n === 'mestolo-user' || n.startsWith('mestolo-user-')).map((n) => caches.delete(n)));
    }
  } catch {
    /* nothing cached */
  }
}

/** Hash opaco dell'id utente, usato per il nome della cache privata (l'id non finisce in chiaro). */
async function hashUserId(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tells the service worker who is logged in; it drops the caches of any other user. */
export function UserCacheSync({ userId }: { userId: string }) {
  useEffect(() => {
    clearOtherUsersDrafts(userId);
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    let cancelled = false;
    (async () => {
      const userHash = await hashUserId(userId);
      const reg = await navigator.serviceWorker.ready;
      if (!cancelled) (navigator.serviceWorker.controller ?? reg.active)?.postMessage({ type: 'set-user', userHash });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return null;
}

/** Clears the private cache when mounted (used on the login page); drafts are kept. */
export function ClearUserCacheOnMount() {
  useEffect(() => {
    clearUserCache({ keepDrafts: true });
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
