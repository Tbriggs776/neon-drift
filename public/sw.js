// ============================================================
// NEON DRIFT - SERVICE WORKER
// ============================================================
// Caches app shell + audio on first load so the game works offline
// and launches instantly on return visits. Skips leaderboard API
// (passes through so network failures don't stale the scores).
// ============================================================

const CACHE_NAME = 'neon-drift-v1';
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API — always fresh network
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    return;
  }

  // Cache-first for same-origin GET, fall back to network
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Opportunistically cache successful responses
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
  }
});
