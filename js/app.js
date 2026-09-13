import { state, resetControls } from './state.js';
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
      // hors-ligne : on continue avec la session locale, sera revérifiée au retour réseau
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
  document.getElementById('userLabel').textContent = `${state.user.prenom} ${state.user.nom}`;
  await loadAppData();
}

// ===== CHARGEMENT DES DONNÉES =====
async function loadAppData() {
  try {
    const fresh = await api.fetchSubstations();
    state.substations = fresh;
    await dbLayer.putAll('substations', fresh);
  } catch {
    state.substations = await dbLayer.getAll('substations');
  }

  state.rondes = await dbLayer.getAll('rondes');
  state.fiches = await dbLayer.getAll('fiches');
  state.actions = await dbLayer.getAll('actions');
  state.mesRecords = await dbLayer.getAll('mes');

  ui.renderSubstationSelect();
  ui.renderControls();
  ui.renderBilan();
  ui.renderFiches();
  ui.renderActions();
  ui.renderHistorique();

  document.getElementById('rondeDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('rondeHeure').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('rondeTech').value = `${state.user.prenom} ${state.user.nom}`;

  initMap();
  renderMarkers(state.substations, (id) => {
    document.getElementById('rondeSubstation').value = id;
    onSubstationChange();
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
});

// ===== SOUS-STATION =====
function onSubstationChange() {
  const id = document.getElementById('rondeSubstation').value;
  const substation = state.substations.find((s) => s.id === id);
  ui.renderAccessNotes(substation);
  if (substation) focusSubstation(substation);
}
document.getElementById('rondeSubstation').addEventListener('change', onSubstationChange);

// ===== CONTRÔLES =====
document.getElementById('controlsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-status"]');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const status = btn.dataset.status;
  state.controls[index].status = status;
  if (status === 'ok' || status === 'na') state.controls[index].comment = '';
  ui.renderControls();
  ui.renderBilan();
});
document.getElementById('controlsList').addEventListener('input', (e) => {
  const field = e.target.closest('[data-action="set-comment"]');
  if (!field) return;
  state.controls[Number(field.dataset.index)].comment = field.value;
});

// ===== ENREGISTRER LA RONDE =====
document.getElementById('saveRondeBtn').addEventListener('click', async () => {
  const substationId = document.getElementById('rondeSubstation').value;
  if (!substationId) {
    ui.showToast('Choisir une sous-station');
    return;
  }

  const ronde = {
    id: `RONDE_${Date.now()}`,
    substation_id: substationId,
    date: document.getElementById('rondeDate').value,
    heure: document.getElementById('rondeHeure').value,
    tech: document.getElementById('rondeTech').value,
    controls: JSON.parse(JSON.stringify(state.controls)),
    observations: document.getElementById('rondeObservations').value,
  };

  await dbLayer.put('rondes', ronde);
  await dbLayer.queueSync('ronde', 'upsert', ronde);
  state.rondes.push(ronde);

  document.getElementById('rondeObservations').value = '';
  resetControls();
  ui.renderControls();
  ui.renderBilan();
  ui.renderDiagnostic(null);
  ui.renderHistorique();
  ui.showToast('Ronde enregistrée');

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
  const type = document.getElementById('ficheType').value;
  const description = document.getElementById('ficheDesc').value.trim();
  if (!type || !description) {
    ui.showToast('Complétez les champs');
    return;
  }
  const fiche = {
    id: `FICHE_${Date.now()}`,
    substation_id: document.getElementById('rondeSubstation').value || null,
    type,
    description,
    date: new Date().toLocaleString('fr-FR'),
  };
  await dbLayer.put('fiches', fiche);
  await dbLayer.queueSync('fiche', 'upsert', fiche);
  state.fiches.push(fiche);
  document.getElementById('ficheType').value = '';
  document.getElementById('ficheDesc').value = '';
  ui.renderFiches();
  ui.showToast('Fiche ajoutée');
});

document.getElementById('fichesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-fiche"]');
  if (!btn) return;
  const id = btn.dataset.id;
  await dbLayer.remove('fiches', id);
  await dbLayer.queueSync('fiche', 'delete', { id });
  state.fiches = state.fiches.filter((f) => f.id !== id);
  ui.renderFiches();
});

// ===== ACTIONS =====
document.getElementById('addActionBtn').addEventListener('click', async () => {
  const input = document.getElementById('actionInput');
  const text = input.value.trim();
  if (!text) return;
  const action = {
    id: `ACTION_${Date.now()}`,
    substation_id: document.getElementById('rondeSubstation').value || null,
    text,
    done: false,
    date: new Date().toLocaleString('fr-FR'),
  };
  await dbLayer.put('actions', action);
  await dbLayer.queueSync('action', 'upsert', action);
  state.actions.push(action);
  input.value = '';
  ui.renderActions();
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
});

// ===== MES =====
document.getElementById('saveMesBtn').addEventListener('click', async () => {
  const record = {
    id: `MES_${Date.now()}`,
    substation_id: document.getElementById('rondeSubstation').value || null,
    phase: document.getElementById('mesPhase').value,
    puissance: document.getElementById('mesPuissance').value || null,
    debit: document.getElementById('mesDebit').value || null,
    temperature: document.getElementById('mesTemp').value || null,
    date: new Date().toLocaleString('fr-FR'),
  };
  await dbLayer.put('mes', record);
  await dbLayer.queueSync('mes', 'upsert', record);
  state.mesRecords.push(record);
  ['mesPhase', 'mesPuissance', 'mesDebit', 'mesTemp'].forEach((id) => (document.getElementById(id).value = ''));
  ui.showToast('MES enregistrée');
});

// ===== HISTORIQUE =====
document.getElementById('historiqueContent').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-ronde"]');
  if (!btn) return;
  const id = btn.dataset.id;
  await dbLayer.remove('rondes', id);
  await dbLayer.queueSync('ronde', 'delete', { id });
  state.rondes = state.rondes.filter((r) => r.id !== id);
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

  const substation = state.substations.find((s) => s.id === document.getElementById('rondeSubstation').value);
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
