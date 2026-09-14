import { state, resetControls, resetMesChecks, emptyEchangeur } from './state.js';
import * as api from './api.js';
import * as dbLayer from './db.js';
import * as ui from './ui.js';
import { initMap, renderMarkers, focusSubstation, invalidateMapSize, isMapAvailable } from './map.js';
import { prefetchTilesAround } from './tiles.js';
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

let histFilter = 'tous';

function getSiteThreshold() {
  return Number(localStorage.getItem('site_threshold_days_v6')) || 30;
}

function checkOverdueReminders() {
  if (localStorage.getItem('reminders_enabled_v6') !== '1') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const lastVisit = {};
  state.rondes.forEach((r) => {
    if (!r.date) return;
    const t = new Date(r.date).getTime();
    if (!lastVisit[r.substation_id] || t > lastVisit[r.substation_id]) lastVisit[r.substation_id] = t;
  });
  const threshold = getSiteThreshold();
  const now = Date.now();
  const overdueCount = state.substations.filter((s) => {
    const last = lastVisit[s.id];
    const days = last ? (now - last) / 86400000 : Infinity;
    return days > threshold;
  }).length;

  const lastNotif = Number(localStorage.getItem('reminders_last_notif_v6') || 0);
  if (overdueCount > 0 && now - lastNotif > 12 * 60 * 60 * 1000) {
    new Notification('Ronde V6 — Sites en retard', {
      body: `${overdueCount} sous-station(s) non visitée(s) depuis plus de ${threshold} jours.`,
    });
    localStorage.setItem('reminders_last_notif_v6', String(now));
  }
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

  const cachedRondes = await dbLayer.getAll('rondes');
  try {
    const fresh = await api.fetchRondes();
    state.rondes = mergeById(cachedRondes, fresh);
    await dbLayer.putAll('rondes', state.rondes);
  } catch {
    state.rondes = cachedRondes;
  }

  const cachedActions = await dbLayer.getAll('actions');
  try {
    const fresh = await api.fetchActions();
    state.actions = mergeById(cachedActions, fresh);
    await dbLayer.putAll('actions', state.actions);
  } catch {
    state.actions = cachedActions;
  }

  const cachedMes = await dbLayer.getAll('mes');
  try {
    const fresh = await api.fetchMesSessions();
    state.mesSessions = mergeById(cachedMes, fresh);
    await dbLayer.putAll('mes', state.mesSessions);
  } catch {
    state.mesSessions = cachedMes;
  }

  ui.renderSubstationDatalist();
  ui.renderSiteList();
  ui.renderControls();
  ui.renderRondeStatut();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderBilanTrend();
  ui.renderSitesNonVisites(getSiteThreshold());
  ui.renderPointsRecurrents();
  ui.renderActionsRetardSite();
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderActions();
  ui.renderMesCasPosteSelect();
  ui.renderMesEchangeurs();
  ui.renderMesNominalRecap();
  ui.renderMesChecks();
  ui.renderMesHistory();
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
  ui.renderStorageUsage();

  document.getElementById('rondeDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('rondeHeure').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('rondeTech').value = `${state.user.prenom} ${state.user.nom}`.trim();
  document.getElementById('mesIntervenant').value = `${state.user.prenom} ${state.user.nom}`.trim();
  document.getElementById('siteThresholdDays').value = getSiteThreshold();

  checkOverdueReminders();

  initMap();
  if (!isMapAvailable()) {
    document.getElementById('map').innerHTML =
      '<div class="map-offline-note">Carte indisponible hors-ligne pour l\'instant — elle se chargera au prochain accès réseau, puis restera disponible hors-ligne.</div>';
  }
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
  if (tab.dataset.tab === 'bilan') {
    ui.renderBilanStats();
    ui.renderBilanTrend();
    ui.renderSitesNonVisites(getSiteThreshold());
    ui.renderPointsRecurrents();
    ui.renderActionsRetardSite();
  }
  if (tab.dataset.tab === 'historique') ui.renderStorageUsage();
  if (tab.dataset.tab === 'sites') ui.renderSiteList(document.getElementById('siteSearch').value);
});

// ===== SITES (fiche technique) =====
document.getElementById('siteSearch').addEventListener('input', (e) => ui.renderSiteList(e.target.value));

document.getElementById('siteList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-action="select-site"]');
  if (!item) return;
  ui.selectSite(item.dataset.id);
});

document.getElementById('siteDetail').addEventListener('click', async (e) => {
  const backBtn = e.target.closest('[data-action="back-to-sites"]');
  if (backBtn) {
    ui.backToSiteList();
    return;
  }
  const removeBtn = e.target.closest('[data-action="remove-site-photo"]');
  if (removeBtn) {
    const site = ui.getSelectedSite();
    if (!site) return;
    site.photos = (site.photos || []).filter((p) => p.id !== removeBtn.dataset.photoId);
    await dbLayer.put('substations', site);
    await dbLayer.queueSync('substation', 'upsert', site);
    ui.renderSiteDetail();
  }
});

document.getElementById('siteDetail').addEventListener('change', async (e) => {
  const fileInput = e.target.closest('[data-action="add-site-photo"]');
  if (!fileInput || !fileInput.files[0]) return;
  const site = ui.getSelectedSite();
  if (!site) return;
  const dataUrl = await fileToDataUrl(fileInput.files[0]);
  site.photos = [...(site.photos || []), { id: `PHOTO_${Date.now()}`, url: dataUrl }];
  await dbLayer.put('substations', site);
  await dbLayer.queueSync('substation', 'upsert', site);
  ui.renderSiteDetail();
});

// ===== SOUS-STATIONS =====
function onSubstationInput() {
  const name = document.getElementById('rondeSubstation').value;
  const substation = ui.findSubstationByName(name);
  ui.renderAccessNotes(substation);
  if (substation) {
    focusSubstation(substation);
    prefetchTilesAround(substation.lat, substation.lon).catch(() => {});
  }
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
  prefetchTilesAround(lat, lon).catch(() => {});
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

document.getElementById('controlsList').addEventListener('click', async (e) => {
  const statusBtn = e.target.closest('[data-action="set-status"]');
  if (statusBtn) {
    const index = Number(statusBtn.dataset.index);
    const status = statusBtn.dataset.status;
    state.controls[index].status = status;
    if (status === 'ok' || status === 'na') {
      state.controls[index].comment = '';
      state.controls[index].photo = null;
      state.controls[index].photoApres = null;
      state.controls[index].actionCreated = false;
    }
    ui.renderControls();
    ui.renderBilan();
    return;
  }
  const removePhotoBtn = e.target.closest('[data-action="remove-photo"]');
  if (removePhotoBtn) {
    state.controls[Number(removePhotoBtn.dataset.index)].photo = null;
    ui.renderControls();
    return;
  }
  const removePhotoApresBtn = e.target.closest('[data-action="remove-photo-apres"]');
  if (removePhotoApresBtn) {
    state.controls[Number(removePhotoApresBtn.dataset.index)].photoApres = null;
    ui.renderControls();
    return;
  }
  const createActionBtn = e.target.closest('[data-action="create-action-inline"]');
  if (createActionBtn) {
    const index = Number(createActionBtn.dataset.index);
    const c = state.controls[index];
    if (c.actionCreated) return;
    const substation = await resolveOrCreateSubstation(document.getElementById('rondeSubstation').value);
    if (!substation) {
      ui.showToast('Indique une sous-station avant de créer une action');
      return;
    }
    const action = {
      id: `ACTION_${Date.now()}_${c.id}`,
      substation_id: substation.id,
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
    c.actionCreated = true;
    ui.renderControls();
    ui.renderActions();
    ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
    ui.showToast('Action corrective créée');
  }
});

document.getElementById('controlsList').addEventListener('input', (e) => {
  const field = e.target.closest('[data-action="set-comment"]');
  if (!field) return;
  const index = Number(field.dataset.index);
  state.controls[index].comment = field.value;
  ui.updateFicheSuggestions(index);
});

document.getElementById('controlsList').addEventListener('change', async (e) => {
  const fileInput = e.target.closest('[data-action="set-photo"]');
  if (fileInput && fileInput.files[0]) {
    const dataUrl = await fileToDataUrl(fileInput.files[0]);
    state.controls[Number(fileInput.dataset.index)].photo = dataUrl;
    ui.renderControls();
    return;
  }
  const fileInputApres = e.target.closest('[data-action="set-photo-apres"]');
  if (fileInputApres && fileInputApres.files[0]) {
    const dataUrl = await fileToDataUrl(fileInputApres.files[0]);
    state.controls[Number(fileInputApres.dataset.index)].photoApres = dataUrl;
    ui.renderControls();
  }
});

// ===== STATUT À L'ISSUE =====
document.getElementById('rondeStatutChoices').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-statut"]');
  if (!btn) return;
  state.rondeStatut = btn.dataset.statut;
  ui.renderRondeStatut();
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
    statut: state.rondeStatut,
    ts: Date.now(),
  };

  await dbLayer.put('rondes', ronde);
  await dbLayer.queueSync('ronde', 'upsert', ronde);
  state.rondes.push(ronde);

  // Anomalies sans action déjà créée manuellement -> actions en attente
  const anomalies = state.controls.filter((c) => c.status === 'warning' || c.status === 'danger');
  let createdCount = 0;
  for (const c of anomalies) {
    if (c.actionCreated) continue;
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
    createdCount++;
  }

  document.getElementById('rondeObservations').value = '';
  resetControls();
  ui.renderControls();
  ui.renderRondeStatut();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderBilanTrend();
  ui.renderPointsRecurrents();
  ui.renderDiagnostic(null);
  ui.renderActions();
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
  ui.showToast(createdCount ? `Ronde archivée · ${createdCount} action(s) créée(s)` : 'Ronde archivée');

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
document.getElementById('toggleAddFicheBtn').addEventListener('click', () => {
  const card = document.getElementById('addFicheCard');
  card.hidden = !card.hidden;
  if (!card.hidden) document.getElementById('ficheTitle').focus();
});

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
  document.getElementById('addFicheCard').hidden = true;
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
  ui.showToast('Fiche ajoutée');
});

document.getElementById('ficheSearch').addEventListener('input', (e) => ui.renderFiches(e.target.value));

document.getElementById('fichesList').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-action="delete-fiche"]');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const fiche = state.fiches.find((f) => f.id === id);
    if (!fiche || fiche.is_reference) return;
    await dbLayer.remove('fiches', id);
    await dbLayer.queueSync('fiche', 'delete', { id });
    state.fiches = state.fiches.filter((f) => f.id !== id);
    ui.renderFiches(document.getElementById('ficheSearch').value);
    ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
    return;
  }
  const catTile = e.target.closest('[data-action="open-fiche-category"]');
  if (catTile) {
    ui.openFicheCategory(catTile.dataset.category);
    ui.renderFiches(document.getElementById('ficheSearch').value);
    return;
  }
  const backBtn = e.target.closest('[data-action="back-to-fiche-catalog"]');
  if (backBtn) {
    ui.backToFicheCatalog();
    document.getElementById('ficheSearch').value = '';
    ui.renderFiches('');
    return;
  }
  const toggleEl = e.target.closest('[data-action="toggle-fiche"]');
  if (toggleEl) {
    ui.toggleFicheExpanded(toggleEl.dataset.id);
    ui.renderFiches(document.getElementById('ficheSearch').value);
  }
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
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
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
    ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
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
    const index = Number(valueField.dataset.index);
    state.mesChecks[index].valeur = valueField.value;
    ui.updateDeviationHint(index);
    return;
  }
  const commentField = e.target.closest('[data-action="set-mes-comment"]');
  if (commentField) {
    state.mesChecks[Number(commentField.dataset.index)].commentaire = commentField.value;
  }
});

// ===== MES : identification du poste =====
document.getElementById('mesCasPoste').addEventListener('change', (e) => {
  state.mesPoste.cas_poste = e.target.value;
});

document.getElementById('mesRepresentantClient').addEventListener('input', (e) => {
  state.mesPoste.representant_client = e.target.value;
});

document.getElementById('mesNbEchangeurs').addEventListener('change', (e) => {
  const n = Math.max(1, Math.min(3, Number(e.target.value) || 1));
  e.target.value = n;
  const echangeurs = state.mesPoste.echangeurs;
  while (echangeurs.length < n) echangeurs.push(emptyEchangeur());
  while (echangeurs.length > n) echangeurs.pop();
  ui.renderMesEchangeurs();
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
});

document.getElementById('mesEchangeursList').addEventListener('input', (e) => {
  const field = e.target.closest('[data-action="set-echangeur"]');
  if (!field) return;
  state.mesPoste.echangeurs[Number(field.dataset.index)][field.dataset.field] = field.value;
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
});
document.getElementById('mesEchangeursList').addEventListener('change', (e) => {
  const field = e.target.closest('[data-action="set-echangeur"]');
  if (!field) return;
  state.mesPoste.echangeurs[Number(field.dataset.index)][field.dataset.field] = field.value;
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
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
    poste: JSON.parse(JSON.stringify(state.mesPoste)),
    notes: document.getElementById('mesNotes').value,
    date: new Date().toLocaleString('fr-FR'),
    ts: Date.now(),
  };
  await dbLayer.put('mes', session);
  await dbLayer.queueSync('mes_session', 'upsert', session);
  state.mesSessions.push(session);
  document.getElementById('mesNotes').value = '';
  document.getElementById('mesSubstation').value = '';
  document.getElementById('mesRepresentantClient').value = '';
  document.getElementById('mesNbEchangeurs').value = 1;
  resetMesChecks();
  ui.renderMesChecks();
  ui.renderMesCasPosteSelect();
  ui.renderMesEchangeurs();
  ui.renderMesNominalRecap();
  ui.renderMesHistory();
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
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
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
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
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
});

document.getElementById('histSearch').addEventListener('input', (e) => {
  ui.renderHistorique(histFilter, e.target.value);
});

document.getElementById('histFilterChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  histFilter = chip.dataset.filter;
  document.querySelectorAll('#histFilterChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
});

document.getElementById('exportExcelBtn').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') {
    ui.showToast('Export Excel indisponible hors-ligne pour l\'instant');
    return;
  }
  const rows = state.rondes.map((r) => {
    const substation = state.substations.find((s) => s.id === r.substation_id);
    const anomalies = (r.controls || []).filter((c) => c.status === 'warning' || c.status === 'danger');
    return {
      Date: r.date || '',
      Heure: r.heure || '',
      'Sous-station': substation ? substation.name : r.substation_id,
      Intervenant: r.tech || '',
      Statut: r.statut || '',
      Anomalies: anomalies.map((a) => a.label).join(', '),
      Observations: r.observations || '',
    };
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Rondes');
  XLSX.writeFile(workbook, `Historique_Ronde_V6_${Date.now()}.xlsx`);
});

document.getElementById('exportBackupBtn').addEventListener('click', async () => {
  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    substations: await dbLayer.getAll('substations'),
    rondes: await dbLayer.getAll('rondes'),
    fiches: await dbLayer.getAll('fiches'),
    actions: await dbLayer.getAll('actions'),
    mes: await dbLayer.getAll('mes'),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sauvegarde_ronde_v6_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  ui.showToast('Sauvegarde téléchargée');
});

document.getElementById('importBackupBtn').addEventListener('click', () => {
  document.getElementById('importBackupFile').click();
});

document.getElementById('importBackupFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    for (const store of ['substations', 'rondes', 'fiches', 'actions', 'mes']) {
      if (Array.isArray(backup[store])) {
        await dbLayer.putAll(store, backup[store]);
        for (const item of backup[store]) {
          const entityType = { substations: 'substation', rondes: 'ronde', fiches: 'fiche', actions: 'action', mes: 'mes_session' }[store];
          await dbLayer.queueSync(entityType, 'upsert', item);
        }
      }
    }
    await loadAppData();
    ui.showToast('Sauvegarde importée');
  } catch (err) {
    ui.showToast('Fichier de sauvegarde invalide');
  }
  e.target.value = '';
});

document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
  // Rondes/actions/MES sont partagées entre techniciens : on n'efface que ce
  // que cet appareil/compte a créé, jamais l'activité des collègues.
  if (!window.confirm('Effacer mes propres rondes, actions et sessions MES (et mes fiches ajoutées) ? Cette action est irréversible. L\'activité des autres techniciens n\'est pas affectée.')) return;
  const isMine = (item) => !item.user_id || item.user_id === state.user.id;
  const ownRondes = state.rondes.filter(isMine);
  const ownActions = state.actions.filter(isMine);
  const ownMes = state.mesSessions.filter(isMine);
  const ownFiches = state.fiches.filter((f) => !f.is_reference);

  for (const r of ownRondes) {
    await dbLayer.remove('rondes', r.id);
    await dbLayer.queueSync('ronde', 'delete', { id: r.id });
  }
  for (const a of ownActions) {
    await dbLayer.remove('actions', a.id);
    await dbLayer.queueSync('action', 'delete', { id: a.id });
  }
  for (const f of ownFiches) {
    await dbLayer.remove('fiches', f.id);
    await dbLayer.queueSync('fiche', 'delete', { id: f.id });
  }
  for (const m of ownMes) {
    await dbLayer.remove('mes', m.id);
    await dbLayer.queueSync('mes_session', 'delete', { id: m.id });
  }

  const ownRondeIds = new Set(ownRondes.map((r) => r.id));
  const ownActionIds = new Set(ownActions.map((a) => a.id));
  const ownMesIds = new Set(ownMes.map((m) => m.id));
  state.rondes = state.rondes.filter((r) => !ownRondeIds.has(r.id));
  state.actions = state.actions.filter((a) => !ownActionIds.has(a.id));
  state.fiches = state.fiches.filter((f) => f.is_reference);
  state.mesSessions = state.mesSessions.filter((m) => !ownMesIds.has(m.id));

  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
  ui.renderActions();
  ui.renderBilanStats();
  ui.renderMesHistory();
  ui.showToast('Ton historique a été effacé');
  syncNow().catch(() => {});
});

// ===== BILAN AVANCÉ =====
document.getElementById('weeklyReportBtn').addEventListener('click', () => {
  if (typeof html2pdf === 'undefined') {
    ui.showToast("Export PDF indisponible hors-ligne pour l'instant");
    return;
  }
  const rondesWeek = state.rondes.filter((r) => {
    if (!r.date) return false;
    const diff = (Date.now() - new Date(r.date).getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  });
  const container = document.createElement('div');
  container.style.padding = '16px';
  container.innerHTML = `
    <h2>Rapport hebdomadaire — Ronde V6 IDEX</h2>
    <p>Généré le ${new Date().toLocaleString('fr-FR')}</p>
    <p>${rondesWeek.length} ronde(s) sur les 7 derniers jours</p>
    <ul>
      ${rondesWeek
        .map((r) => {
          const s = state.substations.find((x) => x.id === r.substation_id);
          return `<li>${ui.formatDateFr(r.date)} ${r.heure} — ${s ? s.name : r.substation_id} — ${r.tech || ''} — statut : ${r.statut || 'operationnel'}</li>`;
        })
        .join('')}
    </ul>
    <h3>Actions en attente</h3>
    <ul>
      ${state.actions
        .filter((a) => !a.done)
        .map((a) => `<li>[${a.severity}] ${a.text}</li>`)
        .join('')}
    </ul>
  `;
  html2pdf()
    .set({ margin: 10, filename: `Rapport_hebdo_${Date.now()}.pdf`, jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' } })
    .from(container)
    .save();
});

document.getElementById('siteThresholdDays').addEventListener('change', (e) => {
  const days = Math.max(1, Number(e.target.value) || 30);
  localStorage.setItem('site_threshold_days_v6', String(days));
  ui.renderSitesNonVisites(days);
});

document.getElementById('enableRemindersBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    ui.showToast('Notifications non supportées sur cet appareil');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    ui.showToast('Autorisation refusée');
    return;
  }
  localStorage.setItem('reminders_enabled_v6', '1');
  ui.showToast('Rappels activés (tant que l\'app est ouverte)');
  checkOverdueReminders();
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
