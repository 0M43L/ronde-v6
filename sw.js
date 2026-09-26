// Service worker — met en cache la coquille applicative pour un fonctionnement hors-ligne.
// Les appels /api/* ne sont jamais mis en cache (auth, données sensibles, toujours frais).
const CACHE_NAME = 'ronde-v6-shell-v47';
// Cache séparée et non-versionnée pour les tuiles de carte préchargées
// (js/tiles.js) : ne doit jamais être purgée lors d'une mise à jour du
// service worker, contrairement à CACHE_NAME qui change à chaque version.
const TILES_CACHE = 'ronde-v6-tiles';
// Comme cette cache n'est jamais purgée entre versions (voir plus haut), elle
// grossirait sinon indéfiniment au fil des mois à mesure que le technicien
// visite de nouveaux sites. Un plafond simple (les plus anciennes tuiles sont
// retirées en premier) suffit à la garder raisonnable sans jamais bloquer
// l'affichage d'une tuile pour autant.
const TILES_CACHE_MAX = 800;

async function trimTilesCache() {
  const cache = await caches.open(TILES_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - TILES_CACHE_MAX;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/js/app.js',
  '/js/api.js',
  '/js/db.js',
  '/js/icons.js',
  '/js/map.js',
  '/js/state.js',
  '/js/sync.js',
  '/js/tiles.js',
  '/js/ui.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, TILES_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // toujours réseau, jamais de cache

  // CDN externes (Leaflet, html2pdf, tuiles de carte) : mis en cache une fois
  // chargés pour survivre hors-ligne. Les tuiles vont dans TILES_CACHE (stable
  // entre versions) ; le reste (libs CDN versionnées dans l'URL) dans CACHE_NAME.
  if (url.origin !== self.location.origin) {
    const isTile = /tile\.openstreetmap\.org$/.test(url.hostname);
    const targetCache = isTile ? TILES_CACHE : CACHE_NAME;
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(targetCache).then((cache) => {
            cache.put(event.request, clone);
            // Vérifier/purger à chaque tuile serait inutilement coûteux (une
            // ronde peut en charger des dizaines) : un tirage aléatoire suffit
            // à garder la cache sous contrôle sans ralentir chaque tuile.
            if (isTile && Math.random() < 0.02) trimTilesCache();
          });
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
