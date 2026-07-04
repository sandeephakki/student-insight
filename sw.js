/* ============================================================
   Student Insight — Service Worker v9.0
   Caches the app shell for offline use.
   Cache is versioned — bump CACHE_VERSION on each deploy.
============================================================ */

const CACHE_VERSION = 'sia-v9.0';
const CACHE_NAME    = CACHE_VERSION;

// App shell assets to cache on install
const SHELL_ASSETS = [
  '/student-insight/',
  '/student-insight/index.html',
  '/student-insight/manifest.json',
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

  // App shell — network first, fallback to cache
  // (This is a stateless, in-browser-only app — no student data ever
  // touches the network or this cache; see index.html's Project
  // Intelligence Block §1 for the privacy model this mirrors.)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
