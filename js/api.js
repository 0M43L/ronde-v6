// Appels réseau vers le backend. Toute fonction ici peut échouer (hors-ligne) :
// les appelants doivent tolérer le rejet et retomber sur le cache local.

export function getToken() {
  return localStorage.getItem('ronde_token');
}

export function getStoredUser() {
  const raw = localStorage.getItem('ronde_user');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem('ronde_token', token);
  localStorage.setItem('ronde_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('ronde_token');
  localStorage.removeItem('ronde_user');
}

async function authedFetch(url, options = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

export async function login(email, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
  return data;
}

export async function verifyToken() {
  const res = await authedFetch('/api/verify');
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function fetchSubstations() {
  const res = await authedFetch('/api/substations');
  if (!res.ok) throw new Error('Impossible de récupérer les sous-stations');
  const data = await res.json();
  return data.substations;
}

// Détail d'un site (avec ses photos) — chargé à la demande, séparément de la
// liste globale qui ne contient pas les photos (voir api/substations.js).
export async function fetchSubstationDetail(id) {
  const res = await authedFetch(`/api/substations?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Impossible de récupérer le détail du site');
  const data = await res.json();
  return data.substation;
}

export async function fetchFiches() {
  const res = await authedFetch('/api/fiches');
  if (!res.ok) throw new Error('Impossible de récupérer les fiches');
  const data = await res.json();
  return data.fiches;
}

export async function fetchRondes() {
  const res = await authedFetch('/api/rondes');
  if (!res.ok) throw new Error('Impossible de récupérer les rondes');
  const data = await res.json();
  return data.rondes;
}

export async function fetchActions() {
  const res = await authedFetch('/api/actions');
  if (!res.ok) throw new Error('Impossible de récupérer les actions');
  const data = await res.json();
  return data.actions;
}

export async function fetchMesSessions() {
  const res = await authedFetch('/api/mes-sessions');
  if (!res.ok) throw new Error('Impossible de récupérer les sessions MES');
  const data = await res.json();
  return data.sessions;
}

export async function pushSyncQueue(queue) {
  const res = await authedFetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue }),
  });
  if (res.status === 401) {
    // Session expirée (token de plus de 7 jours) : retenter tel quel
    // échouerait indéfiniment tant que le technicien ne se reconnecte pas —
    // ne jamais confondre ça avec un simple "en attente de réseau".
    const err = new Error('Session expirée');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (!res.ok) throw new Error('Échec de synchronisation');
  return res.json();
}

export async function requestDiagnostic(substation_name, anomalies) {
  const res = await authedFetch('/api/diagnostic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ substation_name, anomalies }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Diagnostic indisponible');
  return data;
}
