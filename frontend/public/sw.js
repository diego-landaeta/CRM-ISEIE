// CRM ISEIE — Service Worker minimal (offline fallback + cache de assets versionados).
// Estrategia:
//   - HTML/navegación: network-first, fallback a /offline.html si no hay red.
//   - /assets/*-<hash>.{js,css,map}: cache-first (los hashes garantizan invalidación).
//   - /api/*: NUNCA cachear (siempre pasa a red).
//   - imágenes (/iseie-*, /flags/*): cache-first con expiración suave (1 versión).
//
// Cuando este archivo cambia, el navegador detecta la actualización y al recargar
// se activa el nuevo SW automáticamente.
const VERSION = 'v3';
const STATIC_CACHE = `iseie-static-${VERSION}`;
const RUNTIME_CACHE = `iseie-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/iseie-icon-192.png', '/iseie-icon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: red directa, sin cache.
  if (url.pathname.startsWith('/api/')) return;

  // HTML / navegación: network-first.
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Assets versionados: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Imágenes y otros estáticos: stale-while-revalidate.
  if (/\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networked = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached);
        return cached || networked;
      })
    );
  }
});
