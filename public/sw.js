/* Mestolo service worker
 * - static assets (JS/CSS/fonts/icons): cache-first, versioned
 * - pages the user visits (home, recipe book, recipes, shopping list, plan): network-first,
 *   with the last copy available offline
 * - private data cache ("mestolo-user") is wiped on logout and before login, so another
 *   person using the same device never sees someone else's recipes
 * - POST requests (server actions), /api/* (except images) and auth pages are never cached
 */
const VERSION = 'v1';
const STATIC_CACHE = `mestolo-static-${VERSION}`;
const USER_CACHE = 'mestolo-user';
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
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-user-data') {
    event.waitUntil(caches.delete(USER_CACHE));
  }
});

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/icon.svg';
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirstPage(request, cacheable) {
  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    if (cacheable && response.ok && !response.redirected && type.includes('text/html')) {
      (await caches.open(USER_CACHE)).put(request, response.clone());
    }
    return response;
  } catch {
    if (cacheable) {
      const cached = await (await caches.open(USER_CACHE)).match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
    return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(USER_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
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
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    const cacheable = CACHEABLE_PAGES.some((re) => re.test(url.pathname));
    event.respondWith(networkFirstPage(request, cacheable));
  }
});
