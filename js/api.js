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

export async function pushSyncQueue(queue) {
  const res = await authedFetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue }),
  });
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
