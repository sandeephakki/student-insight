/* ============================================================
   Student Insight — Service Worker v11.0
   Caches the app shell for offline use.
   Cache is versioned — bump CACHE_VERSION on each deploy.

   v11.0 (bug #4 fix): SHELL_ASSETS are now built from the service
   worker's own runtime scope (self.registration.scope) instead of
   hardcoded absolute paths starting with "/". A hardcoded "/" always
   resolves to the ORIGIN root — correct for studin.in (prod, served
   at the domain root) but silently wrong for the QA GitHub Pages
   deployment (served under /student-insight/), where it pointed at
   paths that don't exist. self.registration.scope is computed by the
   browser at registration time from wherever sw.js actually lives, so
   this now auto-detects prod / QA / local / any future subpath with
   no hostname or path string-matching needed anywhere in this file.
============================================================ */

const CACHE_VERSION = 'sia-v11.6-robustness';
const CACHE_NAME    = CACHE_VERSION;

// e.g. "https://studin.in/" on prod, or
// "https://sandeephakki-qa.github.io/student-insight/" on QA — whatever
// directory this file was actually registered from.
const SCOPE = self.registration.scope;

// App shell assets to cache on install
const SHELL_ASSETS = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
];

// CDN assets the app depends on (cache on first fetch)
// Kept in sync with the CDN <script> tags in index.html:
// jQuery 3.7.1, SheetJS (xlsx) 0.18.5, jsPDF 2.5.1, JSZip 3.10.1,
// Chart.js 4.4.1, Google Fonts (Inter, DM Sans)
const CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ── Install: pre-cache app shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_ASSETS).catch(err => {
        // Non-fatal — shell may not be available yet on first deploy
        console.warn('[SW] Shell cache failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean up old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: network-first for app shell, cache-first for CDN ── */
self.addEventListener('fetch', event => {
  // Never intercept chrome-extension or non-http
  if (!event.request.url.startsWith('http')) return;

  // CDN assets — cache first, fallback to network
  const isCDN = CDN_ORIGINS.some(o => event.request.url.startsWith(o));
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Sample .xlsx files (samples/*.xlsx on any environment) — always go to
  // network. Never served stale from cache: a stale cached "Try Now" file
  // would silently show a QA tester (or a real user) outdated demo data
  // with no indication it's not the current file.
  if (/\.xlsx($|\?)/i.test(event.request.url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell — network first, fallback to cache
  // (This is a stateless, in-browser-only app — no student data ever
  // touches the network or this cache; see index.html's Project
  // Intelligence Block §1 for the privacy model this mirrors.)
  // v4.29 SW fix: this used to run for EVERY non-CDN/non-xlsx request,
  // including unrelated cross-origin requests (e.g. a dev-server-injected
  // analytics beacon) that this app never asked for and has no cached
  // entry for. When those got CORS-blocked, the .catch() fallback called
  // caches.match(), got `undefined` back, and respondWith(undefined)
  // throws "Failed to convert value to 'Response'" — a real, repeating
  // console error, not just noise. Scope this handler to same-origin
  // requests only (everything this app shell actually owns); anything
  // else is left completely unintercepted, exactly as if this SW didn't
  // exist for it.
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || Response.error())
      )
  );
});
