// Préchargement ciblé des tuiles de carte (OpenStreetMap) autour d'une
// sous-station, pour que la carte reste utilisable si la connexion tombe
// une fois le technicien arrivé sur site (sous-sol, local technique...).
// Volontairement limité à la sous-station consultée (pas de téléchargement
// en masse de toute la zone, pour rester raisonnable vis-à-vis du serveur
// de tuiles public) — mis en cache dans TILES_CACHE (sw.js), qui survit aux
// mises à jour du service worker.
const TILES_CACHE = 'ronde-v6-tiles';
const ZOOMS = [14, 15, 16, 17];
const SUBDOMAINS = 'abc';
// Même plafond que sw.js (qui alimente aussi cette cache en pannant la
// carte) : évite qu'elle ne grossisse indéfiniment au fil des visites.
// Assez grand pour tenir une couverture complète de toute la zone
// d'intervention (voir downloadOfflineMap() plus bas, ~1900 tuiles) en plus
// du remplissage progressif habituel.
const TILES_CACHE_MAX = 2500;

async function trimTilesCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - TILES_CACHE_MAX;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}

function tileXY(lat, lon, z) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  return [x, y];
}

function subdomainFor(x, y) {
  return SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
}

export async function prefetchTilesAround(lat, lon) {
  if (lat == null || lon == null) return;
  if (!('caches' in window) || !navigator.onLine) return;

  const urls = new Set();
  ZOOMS.forEach((z) => {
    const [cx, cy] = tileXY(lat, lon, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        urls.add(`https://${subdomainFor(x, y)}.tile.openstreetmap.org/${z}/${x}/${y}.png`);
      }
    }
  });

  try {
    const cache = await caches.open(TILES_CACHE);
    for (const url of urls) {
      if (await cache.match(url)) continue;
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch {
        // Tuile indisponible (hors-ligne, serveur injoignable) : tant pis, pas bloquant.
      }
    }
    trimTilesCache(cache).catch(() => {});
  } catch {
    // API Cache indisponible (navigateur trop ancien, mode privé strict...) : ignorer.
  }
}

// Couverture complète hors-ligne de toute la zone d'intervention (plutôt que
// le voisinage d'un seul site comme prefetchTilesAround ci-dessus) : utile
// avant de partir vers un secteur à mauvaise réception, pour que la carte
// (Ronde, Sites, trajet) reste utilisable même entre deux sites, pas
// seulement pile sur les pins déjà visités. Déclenché à la demande
// (bouton dédié dans l'onglet Sites), jamais automatiquement — ça
// représente plusieurs centaines de tuiles, pas la peine de le refaire à
// chaque chargement de l'appli.
const OFFLINE_MAP_ZOOMS = [13, 14, 15, 16, 17, 18];
// Marge autour du site le plus excentré, pour couvrir les routes d'accès
// plutôt que de s'arrêter pile sur le pin.
const BBOX_PADDING_DEG = 0.01;
const DOWNLOAD_CONCURRENCY = 6;

function tilesInBbox(latMin, latMax, lonMin, lonMax, z) {
  // Latitude max -> y min (plus on va vers le nord, plus y est petit en
  // projection Web Mercator) : d'où le croisement max/min ci-dessous.
  const [xMin, yMin] = tileXY(latMax, lonMin, z);
  const [xMax, yMax] = tileXY(latMin, lonMax, z);
  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push([x, y, z]);
    }
  }
  return tiles;
}

export async function downloadOfflineMap(substations, onProgress) {
  const positioned = (substations || []).filter((s) => s.lat != null && s.lon != null);
  if (positioned.length === 0) return { downloaded: 0, total: 0, failed: 0 };
  if (!('caches' in window) || !navigator.onLine) return { downloaded: 0, total: 0, failed: 0 };

  const lats = positioned.map((s) => s.lat);
  const lons = positioned.map((s) => s.lon);
  const latMin = Math.min(...lats) - BBOX_PADDING_DEG;
  const latMax = Math.max(...lats) + BBOX_PADDING_DEG;
  const lonMin = Math.min(...lons) - BBOX_PADDING_DEG;
  const lonMax = Math.max(...lons) + BBOX_PADDING_DEG;

  const tiles = OFFLINE_MAP_ZOOMS.flatMap((z) => tilesInBbox(latMin, latMax, lonMin, lonMax, z));
  const urls = [...new Set(tiles.map(([x, y, z]) => `https://${subdomainFor(x, y)}.tile.openstreetmap.org/${z}/${x}/${y}.png`))];

  const cache = await caches.open(TILES_CACHE);
  let downloaded = 0;
  let failed = 0;
  let done = 0;

  async function worker(queue) {
    for (const url of queue) {
      if (!(await cache.match(url))) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res);
            downloaded++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      done++;
      if (onProgress) onProgress(done, urls.length);
    }
  }

  // Divisée en DOWNLOAD_CONCURRENCY files traitées en parallèle plutôt
  // qu'une tuile à la fois : avec ~1900 tuiles, un téléchargement
  // strictement séquentiel prendrait plusieurs minutes pour rien.
  const queues = Array.from({ length: DOWNLOAD_CONCURRENCY }, () => []);
  urls.forEach((url, i) => queues[i % DOWNLOAD_CONCURRENCY].push(url));
  await Promise.all(queues.map(worker));

  trimTilesCache(cache).catch(() => {});
  return { downloaded, total: urls.length, failed };
}
