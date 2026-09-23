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

// Best-effort : invalide la session côté serveur. Si hors-ligne ou en échec,
// on n'empêche pas la déconnexion locale pour autant (voir l'appelant) — le
// token expirera de lui-même après 7 jours dans ce cas.
export async function logout() {
  try {
    await authedFetch('/api/logout', { method: 'POST' });
  } catch {
    /* hors-ligne : tant pis, la session locale est effacée quand même */
  }
}

// Sans limite de temps, une requête sur un réseau faible (sous-sol, zone
// blanche...) peut rester en attente indéfiniment — ni succès ni échec —
// au lieu de rendre la main : côté synchro par exemple, ça bloquait
// l'indicateur de progression figé sur un pourcentage pendant plusieurs
// minutes sans que rien ne se passe, ni du côté du technicien ni du côté
// de l'appli (pas d'erreur à laquelle réagir). 30s laisse largement le
// temps à une photo compressée de passer même sur un réseau lent, tout en
// finissant par échouer proprement plutôt que de pendre pour de bon.
const DEFAULT_TIMEOUT_MS = 30000;

async function authedFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
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

// ===== FACE ID / TOUCH ID (WebAuthn) =====
export async function webauthnRegisterOptions() {
  const res = await authedFetch('/api/webauthn/register-options', { method: 'POST' });
  if (!res.ok) throw new Error('Impossible de préparer l\'inscription Face ID/Touch ID');
  return res.json();
}

export async function webauthnRegisterVerify(attestationResponse, deviceName) {
  const res = await authedFetch('/api/webauthn/register-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...attestationResponse, deviceName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Inscription Face ID/Touch ID refusée');
  return data;
}

export async function webauthnListCredentials() {
  const res = await authedFetch('/api/webauthn/credentials');
  if (!res.ok) return [];
  const data = await res.json();
  return data.credentials || [];
}

export async function webauthnRemoveCredential(id) {
  const res = await authedFetch('/api/webauthn/credentials', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Suppression impossible');
}

// Pas de session existante à ce stade (écran de connexion) : fetch() simple,
// pas authedFetch().
export async function webauthnLoginOptions() {
  const res = await fetch('/api/webauthn/login-options', { method: 'POST' });
  if (!res.ok) throw new Error('Face ID/Touch ID indisponible pour l\'instant');
  return res.json();
}

export async function webauthnLoginVerify(challengeId, assertionResponse) {
  const res = await fetch('/api/webauthn/login-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, response: assertionResponse }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Connexion refusée');
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

// `since` (optionnel, date ISO) : ne récupère que les enregistrements créés
// après cette date — voir loadAppData() côté client pour quand/pourquoi.
export async function fetchRondes(since) {
  const url = since ? `/api/rondes?since=${encodeURIComponent(since)}` : '/api/rondes';
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Impossible de récupérer les rondes');
  const data = await res.json();
  return data.rondes;
}

export async function fetchActions(since) {
  const url = since ? `/api/actions?since=${encodeURIComponent(since)}` : '/api/actions';
  const res = await authedFetch(url);
  if (!res.ok) throw new Error('Impossible de récupérer les actions');
  const data = await res.json();
  return data.actions;
}

export async function fetchMesSessions(since) {
  const url = since ? `/api/mes-sessions?since=${encodeURIComponent(since)}` : '/api/mes-sessions';
  const res = await authedFetch(url);
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
