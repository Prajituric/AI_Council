/* ================================================================
   sw.js — GenX Service Worker (PWA)

   Strategy:
   - App shell (HTML, CSS, JS, fonts): cache-first, update in background.
   - API calls (/api/*): network-only — never cache live model responses.
   - All other requests: network-first, fall back to cache.
   - Offline fallback: serves a minimal offline page if everything fails.
   ================================================================ */

const CACHE_NAME   = 'ai-council-v7';
const OFFLINE_URL  = '/offline.html';

// Static assets to pre-cache on install
const PRECACHE = [
  '/',
  '/style.css',
  '/db.js',
  '/api.js',
  '/ui.js',
  '/app.js',
  '/manifest.json',
];

// ── Install: pre-cache app shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Skip non-http(s) schemes (chrome-extension://, data:, etc.)
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // Always bypass SW for API calls — fresh network data only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return; // let the browser handle it normally
  }

  // Bypass Supabase — never intercept or cache database/realtime calls
  if (url.hostname.endsWith('.supabase.co') || url.hostname === 'supabase.com') {
    return;
  }

  // External CDN resources — network-first, fall back to cache
  // Only cache cacheable (same-origin) responses, skip opaque cross-origin ones
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp && resp.ok && resp.type !== 'opaque') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell — cache-first (stale-while-revalidate)
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      }).catch(() => null);

      // Return cached immediately, update in background; or wait for network
      return cached || networkFetch || new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GenX — Offline</title>' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{background:#0f0f13;color:#e8e8f2;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}' +
        'h1{font-size:24px;font-weight:600}p{color:#8888aa;font-size:14px;text-align:center}</style></head>' +
        '<body><h1>⚡ GenX</h1><p>You\'re offline.<br>Reconnect to continue your conversation.</p></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    })
  );
});
