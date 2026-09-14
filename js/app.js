import { state, resetControls, resetMesChecks } from './state.js';
import * as api from './api.js';
import * as dbLayer from './db.js';
import * as ui from './ui.js';
import { initMap, renderMarkers, focusSubstation, invalidateMapSize } from './map.js';
import { refreshSyncStatus, syncNow, setSyncStatusListener } from './sync.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const loginScreen = document.getElementById('loginScreen');
const appEl = document.getElementById('app');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

// ===== THEME =====
function initTheme() {
  const saved = localStorage.getItem('theme_v6');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme_v6', next);
});

// ===== SYNC PILL =====
setSyncStatusListener((status, count) => {
  const pill = document.getElementById('syncPill');
  const label = document.getElementById('syncLabel');
  pill.className = `sync-pill ${status === 'synced' ? '' : status}`;
  label.textContent = status === 'synced' ? 'à jour' : status === 'offline' ? `hors-ligne (${count})` : `en attente (${count})`;
});

// ===== LOGIN =====
window.addEventListener('load', async () => {
  initTheme();
  const token = api.getToken();
  const cachedUser = api.getStoredUser();
  if (token && cachedUser) {
    try {
      const user = await api.verifyToken();
      if (user === null) {
        api.clearSession();
        return;
      }
      state.user = user;
    } catch {
      state.user = cachedUser;
    }
    await enterApp();
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  try {
    const data = await api.login(email, password);
    api.setSession(data.token, data.user);
    state.user = data.user;
    await enterApp();
  } catch (err) {
    loginError.textContent = err.message || 'Erreur réseau';
    loginError.style.display = 'block';
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  api.clearSession();
  state.user = null;
  appEl.classList.remove('visible');
  loginScreen.style.display = 'flex';
  loginForm.reset();
});

async function enterApp() {
  loginScreen.style.display = 'none';
  appEl.classList.add('visible');
  document.getElementById('userLabel').textContent = `${state.user.prenom} ${state.user.nom}`.trim();
  await loadAppData();
}

// ===== FUSION LOCAL / SERVEUR (offline-first) =====
// Le serveur écrase les entrées connues, mais on garde les entrées créées
// localement (hors-ligne) qui n'ont pas encore été synchronisées.
function mergeById(local, server) {
  const map = new Map(local.map((item) => [item.id, item]));
  server.forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
}

// ===== CHARGEMENT DES DONNÉES =====
async function loadAppData() {
  const cachedSubstations = await dbLayer.getAll('substations');
  try {
    const fresh = await api.fetchSubstations();
    state.substations = mergeById(cachedSubstations, fresh);
    await dbLayer.putAll('substations', state.substations);
  } catch {
    state.substations = cachedSubstations;
  }

  const cachedFiches = await dbLayer.getAll('fiches');
  try {
    const fresh = await api.fetchFiches();
    state.fiches = mergeById(cachedFiches, fresh);
    await dbLayer.putAll('fiches', state.fiches);
  } catch {
    state.fiches = cachedFiches;
  }

  state.rondes = await dbLayer.getAll('rondes');
  state.actions = await dbLayer.getAll('actions');
  state.mesSessions = await dbLayer.getAll('mes');

  ui.renderSubstationDatalist();
  ui.renderControls();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderFiches();
  ui.renderActions();
  ui.renderMesChecks();
  ui.renderMesHistory();
  ui.renderHistorique();

  document.getElementById('rondeDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('rondeHeure').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('rondeTech').value = `${state.user.prenom} ${state.user.nom}`.trim();

  initMap();
  renderMarkers(state.substations, (id) => {
    const s = state.substations.find((x) => x.id === id);
    if (s) {
      document.getElementById('rondeSubstation').value = s.name;
      onSubstationInput();
    }
  });
  invalidateMapSize();

  await refreshSyncStatus();
  syncNow().catch(() => {});
}

// ===== TABS =====
document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  ui.switchTab(tab.dataset.tab);
  if (tab.dataset.tab === 'ronde') invalidateMapSize();
  if (tab.dataset.tab === 'bilan') ui.renderBilanStats();
});

// ===== SOUS-STATIONS =====
function onSubstationInput() {
  const name = document.getElementById('rondeSubstation').value;
  const substation = ui.findSubstationByName(name);
  ui.renderAccessNotes(substation);
  if (substation) focusSubstation(substation);
}
document.getElementById('rondeSubstation').addEventListener('input', onSubstationInput);

async function resolveOrCreateSubstation(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  let substation = ui.findSubstationByName(trimmed);
  if (substation) return substation;
  substation = { id: `SUB_${Date.now()}`, name: trimmed, lat: null, lon: null, notes_acces: '', needs_review: false };
  state.substations.push(substation);
  await dbLayer.put('substations', substation);
  await dbLayer.queueSync('substation', 'upsert', substation);
  ui.renderSubstationDatalist();
  return substation;
}

async function upsertSubstationWithCoords(name, lat, lon) {
  let substation = ui.findSubstationByName(name);
  if (substation) {
    substation.lat = lat;
    substation.lon = lon;
  } else {
    substation = { id: `SUB_${Date.now()}`, name, lat, lon, notes_acces: '', needs_review: false };
    state.substations.push(substation);
  }
  await dbLayer.put('substations', substation);
  await dbLayer.queueSync('substation', 'upsert', substation);
  ui.renderSubstationDatalist();
  renderMarkers(state.substations, (id) => {
    const s = state.substations.find((x) => x.id === id);
    if (s) {
      document.getElementById('rondeSubstation').value = s.name;
      onSubstationInput();
    }
  });
  return substation;
}

document.getElementById('registerGeoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    ui.showToast('Géolocalisation indisponible sur cet appareil');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const current = document.getElementById('rondeSubstation').value.trim();
      const name = window.prompt('Nom de la sous-station à enregistrer à cette position :', current);
      if (!name || !name.trim()) return;
      const substation = await upsertSubstationWithCoords(name.trim(), pos.coords.latitude, pos.coords.longitude);
      document.getElementById('rondeSubstation').value = substation.name;
      onSubstationInput();
      ui.showToast('Sous-station enregistrée avec sa position');
    },
    (err) => ui.showToast(`Position indisponible (${err.message})`),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ===== CONTRÔLES =====
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('controlsList').addEventListener('click', (e) => {
  const statusBtn = e.target.closest('[data-action="set-status"]');
  if (statusBtn) {
    const index = Number(statusBtn.dataset.index);
    const status = statusBtn.dataset.status;
    state.controls[index].status = status;
    if (status === 'ok' || status === 'na') {
      state.controls[index].comment = '';
      state.controls[index].photo = null;
    }
    ui.renderControls();
    ui.renderBilan();
    return;
  }
  const removePhotoBtn = e.target.closest('[data-action="remove-photo"]');
  if (removePhotoBtn) {
    state.controls[Number(removePhotoBtn.dataset.index)].photo = null;
    ui.renderControls();
  }
});

document.getElementById('controlsList').addEventListener('input', (e) => {
  const field = e.target.closest('[data-action="set-comment"]');
  if (!field) return;
  state.controls[Number(field.dataset.index)].comment = field.value;
});

document.getElementById('controlsList').addEventListener('change', async (e) => {
  const fileInput = e.target.closest('[data-action="set-photo"]');
  if (!fileInput || !fileInput.files[0]) return;
  const dataUrl = await fileToDataUrl(fileInput.files[0]);
  state.controls[Number(fileInput.dataset.index)].photo = dataUrl;
  ui.renderControls();
});

// ===== ENREGISTRER LA RONDE =====
document.getElementById('saveRondeBtn').addEventListener('click', async () => {
  const substation = await resolveOrCreateSubstation(document.getElementById('rondeSubstation').value);
  if (!substation) {
    ui.showToast('Indique une sous-station');
    return;
  }

  const ronde = {
    id: `RONDE_${Date.now()}`,
    substation_id: substation.id,
    date: document.getElementById('rondeDate').value,
    heure: document.getElementById('rondeHeure').value,
    tech: document.getElementById('rondeTech').value,
    controls: JSON.parse(JSON.stringify(state.controls)),
    observations: document.getElementById('rondeObservations').value,
    ts: Date.now(),
  };

  await dbLayer.put('rondes', ronde);
  await dbLayer.queueSync('ronde', 'upsert', ronde);
  state.rondes.push(ronde);

  // Anomalies -> actions en attente
  const anomalies = state.controls.filter((c) => c.status === 'warning' || c.status === 'danger');
  for (const c of anomalies) {
    const action = {
      id: `ACTION_${Date.now()}_${c.id}`,
      substation_id: substation.id,
      ronde_id: ronde.id,
      text: `${substation.name} — ${c.label}${c.comment ? ' : ' + c.comment : ''}`,
      severity: c.status === 'danger' ? 'danger' : 'warning',
      source: 'ronde',
      photo: c.photo || null,
      done: false,
      date: new Date().toLocaleString('fr-FR'),
      ts: Date.now(),
    };
    await dbLayer.put('actions', action);
    await dbLayer.queueSync('action', 'upsert', action);
    state.actions.push(action);
  }

  document.getElementById('rondeObservations').value = '';
  resetControls();
  ui.renderControls();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderDiagnostic(null);
  ui.renderActions();
  ui.renderHistorique();
  ui.showToast(anomalies.length ? `Ronde enregistrée · ${anomalies.length} action(s) créée(s)` : 'Ronde enregistrée');

  await refreshSyncStatus();
  syncNow().catch(() => {});
});

document.getElementById('exportPdfBtn').addEventListener('click', () => {
  if (typeof html2pdf === 'undefined') {
    ui.showToast("Export PDF indisponible hors-ligne pour l'instant");
    return;
  }
  const element = document.getElementById('page-ronde');
  html2pdf()
    .set({
      margin: 10,
      filename: `Ronde_${Date.now()}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
    })
    .from(element)
    .save();
});

// ===== FICHES =====
document.getElementById('addFicheBtn').addEventListener('click', async () => {
  const title = document.getElementById('ficheTitle').value.trim();
  const cause_probable = document.getElementById('ficheCause').value.trim();
  const solution = document.getElementById('ficheSolution').value.trim();
  if (!title) {
    ui.showToast('Le titre est requis');
    return;
  }
  const fiche = {
    id: `FICHE_${Date.now()}`,
    title,
    cause_probable,
    solution,
    is_reference: false,
    date: new Date().toLocaleString('fr-FR'),
    ts: Date.now(),
  };
  await dbLayer.put('fiches', fiche);
  await dbLayer.queueSync('fiche', 'upsert', fiche);
  state.fiches.push(fiche);
  ['ficheTitle', 'ficheCause', 'ficheSolution'].forEach((id) => (document.getElementById(id).value = ''));
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderHistorique();
  ui.showToast('Fiche ajoutée');
});

document.getElementById('ficheSearch').addEventListener('input', (e) => ui.renderFiches(e.target.value));

document.getElementById('fichesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-fiche"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const fiche = state.fiches.find((f) => f.id === id);
  if (!fiche || fiche.is_reference) return;
  await dbLayer.remove('fiches', id);
  await dbLayer.queueSync('fiche', 'delete', { id });
  state.fiches = state.fiches.filter((f) => f.id !== id);
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderHistorique();
});

// ===== ACTIONS =====
document.getElementById('addActionBtn').addEventListener('click', async () => {
  const input = document.getElementById('actionInput');
  const text = input.value.trim();
  if (!text) return;
  const substation = ui.findSubstationByName(document.getElementById('rondeSubstation').value);
  const action = {
    id: `ACTION_${Date.now()}`,
    substation_id: substation ? substation.id : null,
    text,
    severity: document.getElementById('actionSeverity').value,
    source: 'manuelle',
    photo: null,
    done: false,
    date: new Date().toLocaleString('fr-FR'),
    ts: Date.now(),
  };
  await dbLayer.put('actions', action);
  await dbLayer.queueSync('action', 'upsert', action);
  state.actions.push(action);
  input.value = '';
  ui.renderActions();
  ui.renderBilanStats();
  ui.renderHistorique();
  ui.showToast('Action ajoutée');
});

document.getElementById('actionsList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-action="delete-action"]');
  if (del) {
    const id = del.dataset.id;
    await dbLayer.remove('actions', id);
    await dbLayer.queueSync('action', 'delete', { id });
    state.actions = state.actions.filter((a) => a.id !== id);
    ui.renderActions();
    ui.renderBilanStats();
    ui.renderHistorique();
  }
});

document.getElementById('actionsList').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-action="toggle-action"]');
  if (!box) return;
  const id = box.dataset.id;
  const action = state.actions.find((a) => a.id === id);
  if (!action) return;
  action.done = box.checked;
  await dbLayer.put('actions', action);
  await dbLayer.queueSync('action', 'upsert', action);
  ui.renderActions();
  ui.renderBilanStats();
});

// ===== MES =====
document.getElementById('mesChecksList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-mes-status"]');
  if (!btn) return;
  state.mesChecks[Number(btn.dataset.index)].status = btn.dataset.status;
  ui.renderMesChecks();
});

document.getElementById('mesChecksList').addEventListener('input', (e) => {
  const valueField = e.target.closest('[data-action="set-mes-value"]');
  if (valueField) {
    state.mesChecks[Number(valueField.dataset.index)].valeur = valueField.value;
    return;
  }
  const commentField = e.target.closest('[data-action="set-mes-comment"]');
  if (commentField) {
    state.mesChecks[Number(commentField.dataset.index)].commentaire = commentField.value;
  }
});

document.getElementById('saveMesBtn').addEventListener('click', async () => {
  const substation = await resolveOrCreateSubstation(document.getElementById('mesSubstation').value);
  if (!substation) {
    ui.showToast('Indique une sous-station');
    return;
  }
  const session = {
    id: `MES_${Date.now()}`,
    substation_id: substation.id,
    checks: JSON.parse(JSON.stringify(state.mesChecks)),
    notes: document.getElementById('mesNotes').value,
    date: new Date().toLocaleString('fr-FR'),
    ts: Date.now(),
  };
  await dbLayer.put('mes', session);
  await dbLayer.queueSync('mes_session', 'upsert', session);
  state.mesSessions.push(session);
  document.getElementById('mesNotes').value = '';
  document.getElementById('mesSubstation').value = '';
  resetMesChecks();
  ui.renderMesChecks();
  ui.renderMesHistory();
  ui.renderHistorique();
  ui.showToast('Session MES enregistrée');
});

document.getElementById('mesHistoryList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-mes"]');
  if (!btn) return;
  const id = btn.dataset.id;
  await dbLayer.remove('mes', id);
  await dbLayer.queueSync('mes_session', 'delete', { id });
  state.mesSessions = state.mesSessions.filter((m) => m.id !== id);
  ui.renderMesHistory();
  ui.renderHistorique();
});

// ===== HISTORIQUE =====
document.getElementById('historiqueContent').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'delete-ronde') {
    await dbLayer.remove('rondes', id);
    await dbLayer.queueSync('ronde', 'delete', { id });
    state.rondes = state.rondes.filter((r) => r.id !== id);
  } else if (action === 'delete-fiche') {
    const fiche = state.fiches.find((f) => f.id === id);
    if (!fiche || fiche.is_reference) return;
    await dbLayer.remove('fiches', id);
    await dbLayer.queueSync('fiche', 'delete', { id });
    state.fiches = state.fiches.filter((f) => f.id !== id);
  } else if (action === 'delete-action') {
    await dbLayer.remove('actions', id);
    await dbLayer.queueSync('action', 'delete', { id });
    state.actions = state.actions.filter((a) => a.id !== id);
  } else if (action === 'delete-mes') {
    await dbLayer.remove('mes', id);
    await dbLayer.queueSync('mes_session', 'delete', { id });
    state.mesSessions = state.mesSessions.filter((m) => m.id !== id);
  } else {
    return;
  }
  ui.renderHistorique();
});

// ===== DIAGNOSTIC IA =====
document.getElementById('runDiagnosticBtn').addEventListener('click', async (e) => {
  const anomalies = state.controls
    .filter((c) => c.status === 'warning' || c.status === 'danger')
    .map((c) => ({ label: c.label, status: c.status, comment: c.comment }));

  if (anomalies.length === 0) {
    ui.showToast('Aucune anomalie à diagnostiquer');
    return;
  }

  const substation = ui.findSubstationByName(document.getElementById('rondeSubstation').value);
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Analyse en cours...';

  try {
    const result = await api.requestDiagnostic(substation ? substation.name : null, anomalies);
    state.lastDiagnostic = result;
    ui.renderDiagnostic(result);
  } catch (err) {
    ui.showToast(err.message || 'Diagnostic indisponible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lancer le diagnostic IA';
  }
});
