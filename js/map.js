let map = null;
let markers = [];
// Regroupe les marqueurs proches en un seul rond avec un nombre (au lieu
// d'empiler des dizaines d'épingles indiscernables) : La Défense concentre
// ~140 sites sur une zone réduite, sans regroupement la carte n'était qu'un
// mur de punaises bleues collées les unes aux autres, illisible. Optionnel :
// si le plugin n'est pas chargé (échec réseau), on retombe sur des
// marqueurs individuels plutôt que de ne rien afficher.
let markerLayer = null;

export function isMapAvailable() {
  return typeof L !== 'undefined';
}

function hasClustering() {
  return typeof L !== 'undefined' && typeof L.markerClusterGroup === 'function';
}

export function initMap() {
  if (map || !document.getElementById('map') || !isMapAvailable()) return;
  map = L.map('map', { attributionControl: false }).setView([48.8905, 2.238], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

export function renderMarkers(substations, onSelect) {
  if (!map || !isMapAvailable()) return;

  if (markerLayer) {
    map.removeLayer(markerLayer);
    markerLayer = null;
  }
  markers.forEach((m) => map.removeLayer(m));
  markers = [];

  const clustering = hasClustering();
  if (clustering) {
    markerLayer = L.markerClusterGroup({ maxClusterRadius: 60, spiderfyOnMaxZoom: true });
  }

  substations.forEach((s) => {
    if (s.lat == null || s.lon == null) return;
    const marker = L.marker([s.lat, s.lon]);
    marker.bindPopup(`<b>${escapeHtml(s.name)}</b>${s.needs_review ? '<br><small>Position à vérifier</small>' : ''}`);
    marker.on('click', () => onSelect && onSelect(s.id));
    if (clustering) {
      markerLayer.addLayer(marker);
    } else {
      marker.addTo(map);
      markers.push(marker);
    }
  });

  if (clustering) map.addLayer(markerLayer);
}

export function focusSubstation(s) {
  if (!map || s.lat == null || s.lon == null) return;
  map.setView([s.lat, s.lon], 17);
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 80);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
