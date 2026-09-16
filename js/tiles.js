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
const TILES_CACHE_MAX = 800;

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
