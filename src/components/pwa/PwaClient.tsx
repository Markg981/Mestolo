'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { clearAllDrafts, clearDraftsOfOtherUsers } from '@/lib/drafts';

/** Registers the service worker (production only, secure contexts only) and offers a reload when a new version is waiting. */
export function ServiceWorkerRegister() {
  const t = useTranslations('offline');
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    const sw = navigator.serviceWorker;
    // true solo se l'aggiornamento e stato richiesto dall'utente: evita reload alla prima installazione (clients.claim)
    let reloading = false;
    const onControllerChange = () => {
      if (!reloading) return;
      window.location.reload();
    };
    sw.addEventListener('controllerchange', onControllerChange);
    const track = (reg: ServiceWorkerRegistration) => {
      const check = (worker: ServiceWorker | null) => {
        if (worker && sw.controller) setWaiting(worker);
      };
      check(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') check(installing);
        });
      });
    };
    sw.register('/sw.js', { scope: '/' }).then(track, () => undefined);
    applyUpdate = (worker: ServiceWorker) => {
      reloading = true;
      worker.postMessage({ type: 'skip-waiting' });
    };
    return () => sw.removeEventListener('controllerchange', onControllerChange);
  }, []);
  if (!waiting) return null;
  return (
    <div role="status" className="no-print fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 bg-ink px-4 py-2 text-sm text-porcelain">
      {t('updateAvailable')}
      <button type="button" className="rounded border border-porcelain px-2 py-0.5 font-medium" onClick={() => applyUpdate(waiting)}>
        {t('updateAction')}
      </button>
    </div>
  );
}

let applyUpdate: (worker: ServiceWorker) => void = () => undefined;

/**
 * Deletes cached private pages/images (called on logout and before login).
 * Does not touch the editor drafts: /login also opens when the session expires, and the drafts are unsaved work.
 */
export async function clearUserCache() {
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

/** Pulizia locale completa (bozze + cache privata del service worker): logout ed eliminazione account. */
export async function clearLocalUserData() {
  clearAllDrafts();
  await clearUserCache();
}

/** Hash opaco dell'id utente, usato per il nome della cache privata (l'id non finisce in chiaro). */
async function hashUserId(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tells the service worker who is logged in; it drops the caches of any other user. */
export function UserCacheSync({ userId, supabaseUrl, supabaseAnonKey }: { userId: string; supabaseUrl?: string; supabaseAnonKey?: string }) {
  // session lost (logout in another tab, expiry, revoked token): drop the private caches
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) void clearUserCache();
    });
    return () => data.subscription.unsubscribe();
  }, [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    // shared device: drafts left by a previous account are dropped once we know who is logged in
    clearDraftsOfOtherUsers(userId);
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

/**
 * Pulizia al submit del logout. Offline il logout (server action) non puo riuscire: si annulla l'invio e si
 * conservano i dati locali, cosi l'utente ancora loggato non perde copia offline e bozze senza essere uscito.
 * Online si pulisce subito: su dispositivo condiviso e meglio non lasciare dati privati se il logout fallisse
 * a meta; l'eventuale sessione residua ripopola la cache al prossimo accesso.
 */
export function handleSignOutSubmit(e: { preventDefault: () => void }, onOffline?: () => void) {
  if (!navigator.onLine) {
    e.preventDefault();
    onOffline?.();
    return;
  }
  void clearLocalUserData();
}

/** Logout button that wipes the offline copy of private pages before signing out. */
export function SignOutButton({ action, label, className }: { action: () => Promise<void>; label: string; className?: string }) {
  const t = useTranslations('offline');
  const [blocked, setBlocked] = useState(false);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        setBlocked(false);
        handleSignOutSubmit(e, () => setBlocked(true));
      }}
    >
      <button type="submit" className={className}>
        {label}
      </button>
      <p role="alert" className={blocked ? 'mt-1 px-3 text-sm text-muted' : 'sr-only'}>
        {blocked ? t('signOutOffline') : ''}
      </p>
    </form>
  );
}
