/* Mestolo service worker
 * - static assets (JS/CSS/fonts/icons): cache-first, versioned
 * - pages the user visits: network-first, last copy available offline
 * - private cache is per user ("mestolo-user-<hash>"): the page tells the worker who is logged in
 *   (postMessage 'set-user'); it is wiped on logout, on 401 / redirect to login, and when the user
 *   changes. Without a known current user nothing private is served from cache.
 * - images: network-first, cached copy used only offline and evicted on 401/403/404/410
 * - POST requests (server actions), /api/* (except images) and auth pages are never cached
 */
importScripts('/sw-logic.js');
const L = self.MestoloSw;
const VERSION = 'v3';
const STATIC_CACHE = `mestolo-static-${VERSION}`;
const META_CACHE = 'mestolo-meta';
const USER_KEY = '/__current-user';
const OFFLINE_URL = '/offline';

const CACHEABLE_PAGES = [/^\/$/, /^\/recipes\/?$/, /^\/recipes\/[0-9a-f-]{36}\/?$/, /^\/shopping\/?$/, /^\/plan\/?$/, /^\/collections(\/[0-9a-f-]{36})?\/?$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll([OFFLINE_URL, '/icons/icon-192.png', '/icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mestolo-static-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      // the legacy shared cache ("mestolo-user") is dropped here
      .then(() => wipeUserCaches(null))
      .then(() => self.clients.claim()),
  );
});

async function getCurrentUser() {
  const res = await (await caches.open(META_CACHE)).match(USER_KEY);
  return res ? res.text() : null;
}

async function setCurrentUser(hash) {
  const meta = await caches.open(META_CACHE);
  if (hash) await meta.put(USER_KEY, new Response(hash));
  else await meta.delete(USER_KEY);
}

/** Deletes every private cache except the one of keepHash (if given). */
async function wipeUserCaches(keepHash) {
  const names = L.cachesToDelete(await caches.keys(), keepHash);
  await Promise.all(names.map((n) => caches.delete(n)));
}

async function onSessionLost() {
  await setCurrentUser(null);
  await wipeUserCaches(null);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'clear-user-data') {
    event.waitUntil(onSessionLost());
  } else if (data.type === 'set-user' && typeof data.userHash === 'string' && data.userHash) {
    event.waitUntil(
      (async () => {
        await wipeUserCaches(data.userHash);
        await setCurrentUser(data.userHash);
      })(),
    );
  }
});

/* Web Push: meal reminders sent by /api/cron/meal-reminders */
self.addEventListener('push', (event) => {
  const p = L.parsePushPayload(event.data ? event.data.text() : '');
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: p.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/plan', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          await w.focus();
          if ('navigate' in w) await w.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/icon.svg' || url.pathname === '/sw-logic.js';
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirstPage(request, cacheable) {
  const user = cacheable ? await getCurrentUser() : null;
  try {
    const response = await fetch(request);
    if (L.isSessionLost(response.status, response.redirected, response.url)) {
      await onSessionLost();
      return response;
    }
    const type = response.headers.get('content-type') || '';
    if (L.canUseUserCache(user) && response.ok && !response.redirected && type.includes('text/html')) {
      (await caches.open(L.userCacheName(user))).put(request, response.clone());
    }
    return response;
  } catch {
    if (L.canUseUserCache(user)) {
      const cached = await (await caches.open(L.userCacheName(user))).match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
    return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

/** Images: network first; the cached copy is only an offline fallback and is dropped when access is revoked. */
async function imageNetworkFirst(request) {
  const user = await getCurrentUser();
  const cache = L.canUseUserCache(user) ? await caches.open(L.userCacheName(user)) : null;
  try {
    const response = await fetch(request);
    if (L.isSessionLost(response.status, response.redirected, response.url)) {
      await onSessionLost();
    } else if (L.shouldEvictImage(response.status)) {
      if (cache) await cache.delete(request);
    } else if (cache && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = cache ? await cache.match(request) : null;
    return cached || new Response('', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith('/api/images/')) {
    event.respondWith(imageNetworkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    const cacheable = CACHEABLE_PAGES.some((re) => re.test(url.pathname));
    event.respondWith(networkFirstPage(request, cacheable));
  }
});
