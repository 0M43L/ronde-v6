let map = null;
let markers = [];

export function isMapAvailable() {
  return typeof L !== 'undefined';
}

export function initMap() {
  if (map || !document.getElementById('map') || !isMapAvailable()) return;
  map = L.map('map', { attributionControl: false }).setView([48.8905, 2.238], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

export function renderMarkers(substations, onSelect) {
  if (!map || !isMapAvailable()) return;
  markers.forEach((m) => map.removeLayer(m));
  markers = [];

  substations.forEach((s) => {
    if (s.lat == null || s.lon == null) return;
    const marker = L.marker([s.lat, s.lon]).addTo(map);
    marker.bindPopup(`<b>${escapeHtml(s.name)}</b>${s.needs_review ? '<br><small>Position à vérifier</small>' : ''}`);
    marker.on('click', () => onSelect && onSelect(s.id));
    markers.push(marker);
  });
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
