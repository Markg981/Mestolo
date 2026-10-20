/* Logica pura del service worker, condivisa con i test (tests/unit/sw-logic.test.ts).
 * Caricata dal service worker con importScripts('/sw-logic.js'). */
(function (root) {
  var USER_CACHE_PREFIX = 'mestolo-user-';
  var AUTH_PATHS = [/^\/login\/?$/, /^\/signup\/?$/, /^\/forgot-password\/?$/, /^\/welcome\/?$/, /^\/auth(\/|$)/];

  /** Nome della cache privata dell'utente (hash opaco dell'id, mai l'id in chiaro). */
  function userCacheName(userHash) {
    return USER_CACHE_PREFIX + userHash;
  }

  function isUserCacheName(name) {
    return name.indexOf(USER_CACHE_PREFIX) === 0 || name === 'mestolo-user';
  }

  /** Cache da cancellare: tutte quelle private, tranne (se presente) quella dell'utente tenuto. */
  function cachesToDelete(names, keepUserHash) {
    var keep = keepUserHash ? userCacheName(keepUserHash) : null;
    return names.filter(function (n) {
      return isUserCacheName(n) && n !== keep;
    });
  }

  function isAuthPath(pathname) {
    return AUTH_PATHS.some(function (re) {
      return re.test(pathname);
    });
  }

  /** Sessione non piu valida: 401 oppure redirect verso una pagina di accesso. */
  function isSessionLost(status, redirected, finalUrl) {
    if (status === 401) return true;
    if (!redirected) return false;
    try {
      return isAuthPath(new URL(finalUrl).pathname);
    } catch {
      return false;
    }
  }

  /** Una pagina autenticata si serve dalla cache solo se l'utente corrente e noto. */
  function canUseUserCache(currentUserHash) {
    return typeof currentUserHash === 'string' && currentUserHash.length > 0;
  }

  /** Immagine non piu accessibile (revocata, cancellata): va tolta dalla cache. */
  function shouldEvictImage(status) {
    return status === 401 || status === 403 || status === 404 || status === 410;
  }

  /** Payload di una notifica push (JSON): testi limitati e url sempre relativo al sito (mai un altro origin). */
  function parsePushPayload(text) {
    var data = {};
    try {
      data = JSON.parse(text || '{}') || {};
    } catch {
      data = {};
    }
    var url = typeof data.url === 'string' && /^\/(?!\/)/.test(data.url) ? data.url : '/plan';
    return {
      title: typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Mestolo',
      body: typeof data.body === 'string' ? data.body.slice(0, 200) : '',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : 'mestolo',
      url: url,
    };
  }

  var api = { userCacheName, isUserCacheName, cachesToDelete, isAuthPath, isSessionLost, canUseUserCache, shouldEvictImage, parsePushPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MestoloSw = api;
})(typeof self !== 'undefined' ? self : globalThis);
