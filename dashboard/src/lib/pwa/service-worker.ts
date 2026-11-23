/**
 * Service worker source, served by `app/sw.js/route.ts` with the build id baked in.
 *
 * Caching rules (see docs in the script header):
 * - Navigations: network first. A successful HTML response is kept in a small,
 *   per-build page cache; offline (or on a gateway error) the cached copy of the
 *   same URL is served, otherwise the precached `/offline` page.
 * - `/_next/static/*`: cache first. Every file name carries a content hash.
 * - Manifest and icons: stale-while-revalidate.
 * - Everything else — `/api/*` included — is not intercepted. API responses are
 *   never written to Cache Storage; the offline market summary keeps living in
 *   the local store (lib/local-store/offline-cache.ts).
 *
 * Page and static caches are named after the build. When a new build activates,
 * both caches of older builds are deleted together, so a cached page never
 * outlives the JS/CSS chunks it references (no stale-HTML trap).
 *
 * The script is a plain string so it can be served from a route and evaluated in
 * `node:vm` by the unit tests. Keep it ES2017 and free of backticks and `${`.
 */

export const SW_VERSION_PLACEHOLDER = "__HISSE_SW_VERSION__";

/** Characters allowed in the version; it ends up in cache names. */
export function sanitizeSwVersion(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return cleaned || "dev";
}

export function serviceWorkerScript(version: string): string {
  return SW_SOURCE.split(SW_VERSION_PLACEHOLDER).join(sanitizeSwVersion(version));
}

const SW_SOURCE = String.raw`/* Hisse Analizi service worker. Generated per build; do not cache this file. */
"use strict";
var VERSION = "__HISSE_SW_VERSION__";
var CACHE_PREFIX = "hisse-";
var STATIC_CACHE = CACHE_PREFIX + "static-" + VERSION;
var PAGES_CACHE = CACHE_PREFIX + "pages-" + VERSION;
var OFFLINE_URL = "/offline";
var HOME_URL = "/";
var SHELL_ASSETS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
var MAX_PAGES = 40;
var NAVIGATION_TIMEOUT_MS = 10000;
var GATEWAY_ERRORS = [502, 503, 504];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/** Hashed build assets referenced by an HTML document (tags and the RSC payload). */
function extractAssetUrls(html) {
  var found = {};
  var pattern = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[A-Za-z0-9_\-.~\/\[\]%@]+?\.(?:js|css|woff2?)/g;
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[0];
    if (path.indexOf("/_next/") !== 0) path = "/_next/" + path;
    found[path] = true;
  }
  return Object.keys(found).sort();
}

function requestKind(request) {
  if (request.method !== "GET") return null;
  var url = new URL(request.url);
  if (!isSameOrigin(url)) return null;
  if (request.headers.get("range")) return null;
  if (url.pathname.indexOf("/_next/static/") === 0) return "static";
  if (url.pathname.indexOf("/api/") === 0 || url.pathname === "/api") return null;
  if (url.pathname === "/sw.js") return null;
  if (request.mode === "navigate") return "navigate";
  if (SHELL_ASSETS.indexOf(url.pathname) !== -1) return "asset";
  return null;
}

/** Cache key of a page: path + query, without the RSC cache-busting parameter or hash. */
function pageKey(rawUrl) {
  var url = new URL(rawUrl, self.location.origin);
  url.hash = "";
  url.searchParams.delete("_rsc");
  return url.pathname + url.search;
}

function isCacheablePage(response) {
  if (!response || response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  var type = response.headers.get("content-type") || "";
  return type.indexOf("text/html") !== -1;
}

function trimPages(cache) {
  return cache.keys().then(function (keys) {
    var removable = keys.filter(function (request) {
      var key = pageKey(request.url);
      return key !== OFFLINE_URL && key !== HOME_URL;
    });
    var excess = removable.length - (MAX_PAGES - 2);
    if (excess <= 0) return undefined;
    return Promise.all(removable.slice(0, excess).map(function (request) { return cache.delete(request); }));
  });
}

/** Re-inserting moves the entry to the end, so cache.keys() order is least recently stored first. */
function storePage(key, response) {
  return caches.open(PAGES_CACHE).then(function (cache) {
    return cache.delete(key).then(function () { return cache.put(key, response); }).then(function () { return trimPages(cache); });
  });
}

/** The precached /offline page answers under the requested URL (the page reads location). */
function offlineResponse() {
  return caches.open(PAGES_CACHE).then(function (cache) {
    return cache.match(OFFLINE_URL).then(function (offline) {
      if (!offline) {
        return new Response("Çevrimdışı. Bu sayfa henüz bu cihazda kayıtlı değil.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response(offline.body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-hisse-offline": "1" },
      });
    });
  });
}

function cachedPage(key) {
  return caches.open(PAGES_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      // A filtered list (?idx=..) falls back to the same page without the query.
      var path = key.split("?")[0];
      return path !== key ? cache.match(path) : undefined;
    });
  });
}

function networkFirstPage(event) {
  var request = event.request;
  var key = pageKey(request.url);
  var network = fetch(request).then(function (response) {
    if (isCacheablePage(response)) {
      event.waitUntil(storePage(key, response.clone()).catch(function () {}));
    }
    return response;
  });
  // Keep the network request alive even when the cache answers first.
  event.waitUntil(network.then(function () {}, function () {}));

  var guarded = network.then(function (response) {
    if (GATEWAY_ERRORS.indexOf(response.status) === -1) return response;
    return cachedPage(key).then(function (hit) { return hit || response; });
  }, function () {
    return cachedPage(key).then(function (hit) { return hit || offlineResponse(); });
  });

  // A hanging connection ("lie-fi"): after the timeout a saved copy answers instead.
  var timer;
  var timedFallback = new Promise(function (resolve) {
    timer = setTimeout(function () {
      cachedPage(key).then(resolve, function () { resolve(undefined); });
    }, NAVIGATION_TIMEOUT_MS);
  });
  guarded.then(function () { clearTimeout(timer); }, function () { clearTimeout(timer); });

  return Promise.race([
    guarded,
    timedFallback.then(function (hit) { return hit || guarded; }),
  ]);
}

function cacheFirst(request) {
  return caches.open(STATIC_CACHE).then(function (cache) {
    return cache.match(request, { ignoreVary: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone()).catch(function () {});
        }
        return response;
      });
    });
  });
}

function staleWhileRevalidate(event) {
  var request = event.request;
  return caches.open(STATIC_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var refresh = fetch(request).then(function (response) {
        if (response.ok && response.type === "basic") return cache.put(request, response.clone()).then(function () { return response; });
        return response;
      });
      if (hit) {
        event.waitUntil(refresh.catch(function () {}));
        return hit;
      }
      return refresh;
    });
  });
}

function fetchHtml(url) {
  return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
    if (!isCacheablePage(response)) throw new Error("not cacheable: " + url + " (" + response.status + ")");
    return response.clone().text().then(function (html) { return { response: response, html: html }; });
  });
}

/** Offline page and its assets are required; the home page is best effort. */
function precache() {
  return Promise.all([caches.open(PAGES_CACHE), caches.open(STATIC_CACHE)]).then(function (opened) {
    var pages = opened[0];
    var statics = opened[1];
    return fetchHtml(OFFLINE_URL).then(function (offline) {
      var required = extractAssetUrls(offline.html);
      return Promise.all(required.map(function (url) { return statics.add(url); }))
        .then(function () { return pages.put(OFFLINE_URL, offline.response); })
        .then(function () {
          var optional = fetchHtml(HOME_URL).then(function (home) {
            return Promise.all(extractAssetUrls(home.html).map(function (url) {
              return statics.add(url).catch(function () {});
            })).then(function () { return pages.put(HOME_URL, home.response); });
          }).catch(function () {});
          var shell = Promise.all(SHELL_ASSETS.map(function (url) { return statics.add(url).catch(function () {}); }));
          return Promise.all([optional, shell]);
        });
    });
  });
}

function deleteOldCaches() {
  return caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) {
      return name.indexOf(CACHE_PREFIX) === 0 && name !== STATIC_CACHE && name !== PAGES_CACHE;
    }).map(function (name) { return caches.delete(name); }));
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(precache().then(function () {
    // First install: nothing to replace, take over right away. Updates wait for the
    // page to ask (SKIP_WAITING) so a running tab is never reloaded mid-use.
    if (!self.registration.active) return self.skipWaiting();
    return undefined;
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(deleteOldCaches().then(function () { return self.clients.claim(); }));
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, pagesCache: PAGES_CACHE });
  }
});

self.addEventListener("fetch", function (event) {
  var kind = requestKind(event.request);
  if (kind === "static") event.respondWith(cacheFirst(event.request));
  else if (kind === "navigate") event.respondWith(networkFirstPage(event));
  else if (kind === "asset") event.respondWith(staleWhileRevalidate(event));
});

self.__hisseSw = {
  VERSION: VERSION,
  STATIC_CACHE: STATIC_CACHE,
  PAGES_CACHE: PAGES_CACHE,
  extractAssetUrls: extractAssetUrls,
  requestKind: requestKind,
  pageKey: pageKey,
  isCacheablePage: isCacheablePage,
};
`;
