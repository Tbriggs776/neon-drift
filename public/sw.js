// ============================================================
// NEON DRIFT - SERVICE WORKER
// ============================================================
// Network-first for HTML / manifest so fresh deploys appear without
// the user having to clear cache. Cache-first for /audio and /assets
// since those are content-hashed per build and never change for a
// given URL. Bump CACHE_VERSION on schema changes to force purge.
// ============================================================

const CACHE_VERSION = 'neon-drift-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/audio/bgm.mp3',
  '/audio/shoot.mp3',
  '/audio/explosion.mp3',
  '/audio/bosswarn.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase API
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isHTMLish = url.pathname === '/'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.webmanifest');

  if (isHTMLish) {
    // Network-first: always try fresh, fall back to cache if offline.
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first for hashed assets and audio.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
  }
});
