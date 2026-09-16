import { state, resetControls, resetMesChecks, emptyEchangeur } from './state.js';
import * as api from './api.js';
import * as dbLayer from './db.js';
import * as ui from './ui.js';
import { initMap, renderMarkers, focusSubstation, invalidateMapSize, isMapAvailable } from './map.js';
import { prefetchTilesAround } from './tiles.js';
import { refreshSyncStatus, syncNow, setSyncStatusListener, setSyncErrorListener } from './sync.js';

// Détection de mise à jour : sans ça, un technicien qui garde l'appli
// ouverte (ou la rouvre sans la fermer complètement d'abord) continue de
// tourner sur le JS mis en cache avant un déploiement — les nouvelles
// fonctionnalités "n'existent pas" pour lui tant qu'il n'a pas rechargé.
// On ne recharge JAMAIS automatiquement (il peut être en train de remplir
// une ronde), on affiche juste un bandeau qu'il touche quand il est prêt.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (reg.waiting) showUpdateBanner();
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
        });
      });
      // Le navigateur ne revérifie pas systématiquement à chaque réouverture
      // (surtout si l'appli n'a pas été complètement fermée entre-temps) :
      // sans ça, un technicien qui rouvre l'appli juste après un déploiement
      // peut encore tourner un moment sur l'ancienne version avant que le
      // navigateur ne fasse sa propre vérification. On la force nous-mêmes
      // à chaque fois que l'appli redevient visible.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}

function showUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  banner.hidden = false;
  banner.addEventListener('click', () => window.location.reload(), { once: true });
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
let errorToastShown = false;
setSyncStatusListener((status, count, error) => {
  const pill = document.getElementById('syncPill');
  const label = document.getElementById('syncLabel');
  pill.className = `sync-pill ${status === 'synced' ? '' : status}`;
  if (status === 'synced') label.textContent = 'à jour';
  else if (status === 'offline') label.textContent = `hors-ligne (${count})`;
  else if (status === 'error') {
    label.textContent = error?.code === 'UNAUTHORIZED' ? `session expirée (${count})` : `échec de synchro (${count})`;
    // Un seul toast à l'entrée dans cet état, pas un à chaque nouvelle
    // tentative ratée (toutes les 5 min) : sinon ça spamme le technicien
    // sans rien lui apprendre de plus après le premier.
    if (!errorToastShown) {
      errorToastShown = true;
      ui.showToast(
        error?.code === 'UNAUTHORIZED'
          ? `Session expirée : déconnecte-toi puis reconnecte-toi pour synchroniser tes ${count} élément(s) en attente. Rien n'est perdu, ils sont toujours sur ce téléphone.`
          : `Impossible de synchroniser tes ${count} élément(s) en attente. Touche le badge "${label.textContent}" en haut pour réessayer.`
      );
    }
  } else {
    errorToastShown = false;
    label.textContent = `en attente (${count})`;
  }
});

document.getElementById('syncPill').addEventListener('click', async () => {
  ui.showToast('Tentative de synchronisation...');
  try {
    const result = await syncNow();
    if (result.skipped) ui.showToast('Toujours hors-ligne — réessaie quand tu as du réseau');
    else if ((result.errors || []).length === 0) ui.showToast('Synchronisation réussie');
  } catch (err) {
    ui.showToast(err.code === 'UNAUTHORIZED' ? 'Session expirée : déconnecte-toi puis reconnecte-toi' : 'Échec de synchronisation, nouvelle tentative dans quelques minutes');
  }
});

// Le serveur a rejeté certaines entrées : soit une donnée invalide (reste en
// file, sera retentée), soit un conflit d'édition sur une fiche (deux
// techniciens l'ont modifiée hors ligne en même temps) — dans ce cas on ne
// retente jamais l'envoi tel quel (il échouerait indéfiniment). Les deux
// versions sont mises de côté pour que le technicien les compare et
// choisisse lui-même quoi garder, champ par champ — jamais un écrasement
// automatique et jamais une perte silencieuse.
setSyncErrorListener(async (failedItems, errors) => {
  const errorById = new Map(errors.map((e) => [e.id, e.error]));
  const other = [];
  for (const item of failedItems) {
    const code = errorById.get(item.id);
    if (item.entity_type === 'fiche' && code === 'CONFLICT') {
      await captureFicheConflict(item);
    } else if (item.entity_type === 'fiche' && code === 'FORBIDDEN_NOT_OWNER') {
      await rejectNonOwnedFicheEdit(item);
    } else {
      other.push(item);
    }
  }
  if (other.length > 0) {
    ui.showToast(
      other.length === 1
        ? "1 élément n'a pas pu être synchronisé, nouvelle tentative automatique"
        : `${other.length} éléments n'ont pas pu être synchronisés, nouvelle tentative automatique`
    );
  }
});

async function captureFicheConflict(item) {
  const localFiche = item.payload;
  // Cette version précise n'existe plus côté serveur : retenter l'envoi tel
  // quel échouerait indéfiniment (le toast reviendrait à chaque synchro).
  await dbLayer.clearSyncQueueItems([item.id]);

  let serverFiche = null;
  try {
    const fresh = await api.fetchFiches();
    serverFiche = fresh.find((f) => f.id === localFiche.id) || null;
  } catch {
    // Hors-ligne : on retentera de récupérer la version serveur au prochain
    // cycle de synchro (le conflit reste affiché en attendant).
  }
  if (!serverFiche) return;

  // La liste affichée doit refléter la vraie version en base tant que le
  // conflit n'est pas résolu (jamais la tentative locale rejetée).
  state.fiches = state.fiches.map((f) => (f.id === serverFiche.id ? serverFiche : f));
  await dbLayer.put('fiches', serverFiche);

  const conflict = { id: `CONFLICT_${localFiche.id}_${Date.now()}`, ficheId: localFiche.id, localFiche, serverFiche, detectedAt: Date.now() };
  await dbLayer.addFicheConflict(conflict);
  state.ficheConflicts.push(conflict);

  // Le conteneur du bandeau de conflit existe toujours dans le DOM (même
  // onglet caché) : le remettre à jour tout de suite, pas seulement si
  // l'onglet Fiches est déjà ouvert, sinon le technicien ne le verrait
  // qu'après un rechargement complet de l'appli.
  ui.renderFicheConflicts();
  if (state.currentTab === 'fiches') ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
  ui.showToast(`${serverFiche.tech || 'Un collègue'} a modifié "${serverFiche.title}" en même temps que toi — va dans l'onglet Fiches pour comparer et fusionner.`);
}

// Seul l'auteur d'une fiche terrain peut la modifier (voir api/sync.js). Le
// bouton "Modifier" est déjà caché côté UI pour une fiche qui n'appartient
// pas au technicien connecté ; ce cas ne devrait donc arriver qu'en cas
// d'état local périmé (ex : la fiche a changé de propriétaire entre-temps,
// improbable, ou une modification restée en file depuis avant ce
// changement de règle). On n'insiste jamais : pas de nouvelle tentative,
// on resynchronise la vraie version et on prévient.
async function rejectNonOwnedFicheEdit(item) {
  await dbLayer.clearSyncQueueItems([item.id]);
  try {
    const fresh = await api.fetchFiches();
    const serverFiche = fresh.find((f) => f.id === item.payload.id);
    if (serverFiche) {
      state.fiches = state.fiches.map((f) => (f.id === serverFiche.id ? serverFiche : f));
      await dbLayer.put('fiches', serverFiche);
    }
  } catch {
    // Hors-ligne : la version correcte reviendra au prochain chargement de l'appli.
  }
  if (state.currentTab === 'fiches') ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.showToast(`Tu ne peux modifier que les fiches que tu as créées ("${item.payload.title}" appartient à un autre technicien).`);
}

document.getElementById('ficheConflicts').addEventListener('click', async (e) => {
  const openBtn = e.target.closest('[data-action="open-fiche-conflict"]');
  if (openBtn) {
    ui.openFicheConflict(openBtn.dataset.id);
    return;
  }
  const closeBtn = e.target.closest('[data-action="close-fiche-conflict"]');
  if (closeBtn) {
    ui.closeFicheConflict();
    return;
  }
  const confirmBtn = e.target.closest('[data-action="confirm-fiche-conflict"]');
  if (confirmBtn) {
    const conflict = state.ficheConflicts.find((c) => c.id === confirmBtn.dataset.id);
    if (!conflict) return;

    // Reconstitue le champ choisi (local/serveur) pour chaque champ affiché,
    // en partant de la version serveur à jour (donc son .version courant,
    // indispensable pour que la synchro qui suit soit acceptée).
    const merged = { ...conflict.serverFiche };
    for (const { field } of ui.FICHE_CONFLICT_FIELDS) {
      const picked = document.querySelector(`input[name="conflict-${conflict.id}-${field}"]:checked`);
      if (picked && picked.value === 'local') merged[field] = conflict.localFiche[field];
    }
    // Photos : fusionnées (les deux techniciens ont pu en ajouter chacun de leur côté).
    const serverPhotos = conflict.serverFiche.photos || [];
    const localPhotos = conflict.localFiche.photos || [];
    const byId = new Map(serverPhotos.map((p) => [p.id, p]));
    for (const p of localPhotos) if (!byId.has(p.id)) byId.set(p.id, p);
    merged.photos = Array.from(byId.values());

    await dbLayer.put('fiches', merged);
    await dbLayer.queueSync('fiche', 'upsert', merged);
    state.fiches = state.fiches.map((f) => (f.id === merged.id ? merged : f));

    await dbLayer.removeFicheConflict(conflict.id);
    state.ficheConflicts = state.ficheConflicts.filter((c) => c.id !== conflict.id);
    ui.closeFicheConflict();
    ui.renderFiches(document.getElementById('ficheSearch').value);
    ui.showToast('Fusion enregistrée, en cours de synchronisation');
    syncNow().catch(() => {});
  }
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
// localement (hors-ligne) qui n'ont pas encore été synchronisées. On garde
// aussi telles quelles les entrées qui ont une modification encore en file
// d'attente (pendingIds) : sinon un rechargement de l'appli avant que cette
// modification n'ait fini de synchroniser affiche la version serveur
// (encore ancienne) à la place de la modification du technicien — pas une
// perte de données (la file la renverra), mais une régression d'affichage
// trompeuse le temps que ça synchronise.
function mergeById(local, server, pendingIds) {
  const map = new Map(local.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (pendingIds && pendingIds.has(item.id)) return;
    map.set(item.id, item);
  });
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
  const queue = await dbLayer.getSyncQueue();
  const pendingIdsFor = (entityType) =>
    new Set(queue.filter((q) => q.entity_type === entityType && q.action === 'upsert').map((q) => q.payload.id));

  const [cachedSubstations, cachedFiches, cachedRondes, cachedActions, cachedMes] = await Promise.all([
    dbLayer.getAll('substations'),
    dbLayer.getAll('fiches'),
    dbLayer.getAll('rondes'),
    dbLayer.getAll('actions'),
    dbLayer.getAll('mes'),
  ]);

  // Les 5 entités sont récupérées EN PARALLÈLE plutôt que l'une après
  // l'autre : sur un réseau de sous-sol lent, 5 allers-retours séquentiels
  // pouvaient prendre plusieurs secondes avant que l'appli n'affiche quoi
  // que ce soit de frais au démarrage. En parallèle, l'attente totale est
  // celle de la requête la plus lente des 5, pas leur somme. Chaque entité
  // garde son propre repli sur le cache local en cas d'échec individuel
  // (une fiche indisponible ne doit pas bloquer les rondes, par exemple).
  await Promise.all([
    (async () => {
      try {
        const fresh = await api.fetchSubstations();
        state.substations = mergeById(cachedSubstations, fresh, pendingIdsFor('substation'));
        // La liste globale n'inclut plus les photos ni les commentaires (voir
        // api/substations.js — chargés à la demande sur la fiche Site). Sans ça,
        // chaque rechargement de l'appli écraserait ce qui a déjà été récupéré
        // (ou ajouté localement hors-ligne, voir loadSiteDetailIfNeeded).
        const cachedById = new Map(cachedSubstations.map((s) => [s.id, s]));
        state.substations = state.substations.map((s) => {
          const cached = cachedById.get(s.id);
          return {
            ...s,
            photos: s.photos !== undefined ? s.photos : cached?.photos,
            comments: s.comments !== undefined ? s.comments : cached?.comments,
            detailLoaded: s.detailLoaded !== undefined ? s.detailLoaded : cached?.detailLoaded,
          };
        });
        await dbLayer.putAll('substations', state.substations);
      } catch {
        state.substations = cachedSubstations;
      }
    })(),
    (async () => {
      try {
        const fresh = await api.fetchFiches();
        state.fiches = mergeById(cachedFiches, fresh, pendingIdsFor('fiche'));
        await dbLayer.putAll('fiches', state.fiches);
      } catch {
        state.fiches = cachedFiches;
      }
    })(),
    (async () => {
      try {
        const fresh = await api.fetchRondes();
        state.rondes = mergeById(cachedRondes, fresh, pendingIdsFor('ronde'));
        await dbLayer.putAll('rondes', state.rondes);
      } catch {
        state.rondes = cachedRondes;
      }
    })(),
    (async () => {
      try {
        const fresh = await api.fetchActions();
        state.actions = mergeById(cachedActions, fresh, pendingIdsFor('action'));
        await dbLayer.putAll('actions', state.actions);
      } catch {
        state.actions = cachedActions;
      }
    })(),
    (async () => {
      try {
        const fresh = await api.fetchMesSessions();
        state.mesSessions = mergeById(cachedMes, fresh, pendingIdsFor('mes_session'));
        await dbLayer.putAll('mes', state.mesSessions);
      } catch {
        state.mesSessions = cachedMes;
      }
    })(),
  ]);

  state.ficheConflicts = await dbLayer.getFicheConflicts();

  ui.renderSubstationDatalist();
  ui.renderSiteList();
  ui.renderControls();
  ui.renderRondeStatut();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderBilanTrend();
  ui.renderSitesNonVisites(getSiteThreshold());
  ui.renderPointsRecurrents();
  ui.renderSitesASurveiller();
  ui.renderActionsRetardSite();
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderFicheConflicts();
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

  restoreRondeDraft();
  restoreMesDraft();
  restoreFicheDraft();

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
    ui.renderSitesASurveiller();
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
  loadSiteDetailIfNeeded(item.dataset.id);
});

document.getElementById('sitesASurveiller').addEventListener('click', (e) => {
  const item = e.target.closest('[data-action="goto-site-alert"]');
  if (!item) return;
  ui.switchTab('sites');
  ui.renderSiteList();
  ui.selectSite(item.dataset.id);
  loadSiteDetailIfNeeded(item.dataset.id);
});

// Les photos et commentaires ne sont pas inclus dans la liste globale des
// sous-stations (voir api/substations.js) : on les récupère au moment où le
// technicien ouvre réellement la fiche du site, pas à chaque chargement de
// l'appli.
//
// Le fait d'avoir déjà chargé le détail est suivi par site.detailLoaded
// (persisté), PAS par la simple présence de site.photos/comments : sur le
// terrain sans réseau, on ajoute quand même localement une photo ou un
// commentaire (voir plus bas) avant même d'avoir pu récupérer le détail
// serveur, donc photos/comments existent sans que detailLoaded soit vrai.
// Sans cette distinction, le premier ajout hors-ligne rendait "déjà chargé"
// pour de bon et l'appli n'essayait plus jamais de récupérer le vrai détail
// serveur une fois reconnectée (photos/commentaires des collègues jamais
// vus sur cet appareil).
function unionById(serverItems, localItems) {
  const map = new Map(serverItems.map((item) => [item.id, item]));
  (localItems || []).forEach((item) => {
    if (!map.has(item.id)) map.set(item.id, item);
  });
  return Array.from(map.values());
}

async function loadSiteDetailIfNeeded(id) {
  const site = state.substations.find((s) => s.id === id);
  if (!site || site.detailLoaded) return;
  try {
    const detail = await api.fetchSubstationDetail(id);
    site.photos = unionById(detail.photos || [], site.photos);
    site.comments = unionById(detail.comments || [], site.comments);
    site.detailLoaded = true;
    await dbLayer.put('substations', site);
    if (ui.getSelectedSite()?.id === id) ui.renderSiteDetail();
  } catch {
    // Hors-ligne : on garde ce qui est déjà en local (y compris les photos et
    // commentaires ajoutés hors-ligne) et on retentera le chargement complet
    // à la prochaine ouverture avec réseau.
  }
}

document.getElementById('siteDetail').addEventListener('click', async (e) => {
  const backBtn = e.target.closest('[data-action="back-to-sites"]');
  if (backBtn) {
    ui.backToSiteList();
    return;
  }
  const removeBtn = e.target.closest('[data-action="remove-site-photo"]');
  if (removeBtn) {
    const site = ui.getSelectedSite();
    if (!site || !site.photos) return;
    const photoId = removeBtn.dataset.photoId;
    site.photos = site.photos.filter((p) => p.id !== photoId);
    await dbLayer.put('substations', site);
    // Envoyée comme une opération ciblée (retirer CETTE photo), pas comme un
    // remplacement du tableau entier : si un collègue ajoute une photo sur ce
    // même site avant que ça ne synchronise, sa photo n'est pas perdue.
    await dbLayer.queueSync('substation_photo', 'remove', { substation_id: site.id, photo_id: photoId });
    ui.renderSiteDetail();
    return;
  }
  const removeCommentBtn = e.target.closest('[data-action="remove-site-comment"]');
  if (removeCommentBtn) {
    const site = ui.getSelectedSite();
    if (!site || !site.comments) return;
    const commentId = removeCommentBtn.dataset.commentId;
    site.comments = site.comments.filter((c) => c.id !== commentId);
    await dbLayer.put('substations', site);
    await dbLayer.queueSync('substation_comment', 'remove', { substation_id: site.id, comment_id: commentId });
    ui.renderSiteDetail();
    return;
  }
  const addCommentBtn = e.target.closest('[data-action="add-site-comment"]');
  if (addCommentBtn) {
    const site = ui.getSelectedSite();
    if (!site) return;
    const textarea = document.getElementById('siteCommentInput');
    const text = textarea.value.trim();
    if (!text) return;
    const comment = { id: `COMMENT_${Date.now()}`, text, user_id: state.user.id, tech: `${state.user.prenom} ${state.user.nom}`.trim(), date: new Date().toISOString() };
    site.comments = [...(site.comments || []), comment];
    await dbLayer.put('substations', site);
    // Même logique que les photos : opération d'ajout ciblée, pas un upsert
    // du site entier — deux techniciens qui commentent le même site hors
    // ligne se retrouvent bien tous les deux dans la liste.
    await dbLayer.queueSync('substation_comment', 'add', { substation_id: site.id, comment });
    textarea.value = '';
    ui.renderSiteDetail();
    return;
  }
  const editCommentBtn = e.target.closest('[data-action="edit-site-comment"]');
  if (editCommentBtn) {
    ui.setEditingComment(editCommentBtn.dataset.commentId);
    return;
  }
  const cancelCommentBtn = e.target.closest('[data-action="cancel-site-comment"]');
  if (cancelCommentBtn) {
    ui.setEditingComment(null);
    return;
  }
  const saveCommentBtn = e.target.closest('[data-action="save-site-comment"]');
  if (saveCommentBtn) {
    const site = ui.getSelectedSite();
    if (!site || !site.comments) return;
    const commentId = saveCommentBtn.dataset.commentId;
    const textarea = document.getElementById('editCommentInput');
    const text = textarea.value.trim();
    if (!text) {
      ui.showToast('Le commentaire ne peut pas être vide');
      return;
    }
    site.comments = site.comments.map((c) => (c.id === commentId ? { ...c, text, edited_at: new Date().toISOString() } : c));
    await dbLayer.put('substations', site);
    await dbLayer.queueSync('substation_comment', 'edit', { substation_id: site.id, comment_id: commentId, text });
    ui.setEditingComment(null);
    return;
  }
  const editInfoBtn = e.target.closest('[data-action="edit-site-info"]');
  if (editInfoBtn) {
    ui.toggleSiteInfoEdit(true);
    return;
  }
  const cancelInfoBtn = e.target.closest('[data-action="cancel-site-info"]');
  if (cancelInfoBtn) {
    ui.toggleSiteInfoEdit(false);
    return;
  }
  const saveInfoBtn = e.target.closest('[data-action="save-site-info"]');
  if (saveInfoBtn) {
    const site = ui.getSelectedSite();
    if (!site) return;
    const name = document.getElementById('editSiteName').value.trim();
    if (!name) {
      ui.showToast('Le nom de la sous-station ne peut pas être vide');
      return;
    }
    const existing = ui.findSubstationByName(name);
    if (existing && existing.id !== site.id) {
      ui.showToast('Une autre sous-station porte déjà ce nom');
      return;
    }
    site.name = name;
    site.notes_acces = document.getElementById('editSiteNotes').value.trim();
    await dbLayer.put('substations', site);
    // Le nom et les notes d'accès sont des infos communes au site (pas
    // propres à un technicien), donc synchronisées comme le reste des
    // champs de base via l'upsert 'substation' habituel — jamais les
    // photos/commentaires, gérés à part (voir substation_photo/comment).
    await dbLayer.queueSync('substation', 'upsert', site);
    ui.renderSubstationDatalist();
    ui.renderSiteList(document.getElementById('siteSearch').value);
    ui.toggleSiteInfoEdit(false);
    ui.showToast('Sous-station mise à jour');
    return;
  }
});

document.getElementById('siteDetail').addEventListener('change', async (e) => {
  const fileInput = e.target.closest('[data-action="add-site-photo"]');
  if (!fileInput || !fileInput.files[0]) return;
  const site = ui.getSelectedSite();
  if (!site) return;
  const dataUrl = await fileToDataUrl(fileInput.files[0]);
  const photo = { id: `PHOTO_${Date.now()}`, url: dataUrl };
  site.photos = [...(site.photos || []), photo];
  await dbLayer.put('substations', site);
  // Même logique : opération d'ajout ciblée plutôt qu'un upsert du site
  // entier, pour que deux techniciens puissent ajouter des photos au même
  // site hors ligne sans que l'un écrase l'ajout de l'autre à la synchro.
  await dbLayer.queueSync('substation_photo', 'add', { substation_id: site.id, photo });
  ui.renderSiteDetail();
});

// ===== SOUS-STATIONS =====
function onSubstationInput() {
  const name = document.getElementById('rondeSubstation').value;
  const substation = ui.findSubstationByName(name);
  ui.renderAccessNotes(substation);
  ui.renderRondeSiteAlert(substation);
  if (substation) {
    focusSubstation(substation);
    prefetchTilesAround(substation.lat, substation.lon).catch(() => {});
  }
}
document.getElementById('rondeSubstation').addEventListener('input', () => {
  onSubstationInput();
  saveRondeDraft();
});

async function resolveOrCreateSubstation(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  let substation = ui.findSubstationByName(trimmed);
  if (substation) return substation;
  substation = { id: `SUB_${Date.now()}`, name: trimmed, lat: null, lon: null, notes_acces: '', needs_review: false, photos: [], comments: [], detailLoaded: true };
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
    substation = { id: `SUB_${Date.now()}`, name, lat, lon, notes_acces: '', needs_review: false, photos: [], comments: [], detailLoaded: true };
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

// ===== AJOUT MANUEL D'UNE SOUS-STATION (onglet Sites) =====
// Pour enregistrer un site sans avoir à démarrer une ronde ni attendre un
// signal GPS (armoire en sous-sol, technicien qui veut juste préparer la
// liste avant de partir sur site...). La position reste optionnelle : sans
// elle, le site est marqué "à vérifier" pour rappeler qu'il faudra la
// compléter plus tard (bouton GPS déjà utilisé côté Localisation).
let newSiteCoords = null;

document.getElementById('addSiteBtn').addEventListener('click', () => {
  document.getElementById('newSiteName').value = '';
  document.getElementById('newSiteNotes').value = '';
  newSiteCoords = null;
  document.getElementById('newSiteGeoStatus').textContent = 'Position GPS non renseignée — tu pourras la préciser plus tard.';
  document.getElementById('siteListCard').style.display = 'none';
  document.getElementById('addSiteForm').hidden = false;
});

document.getElementById('cancelNewSiteBtn').addEventListener('click', () => {
  document.getElementById('addSiteForm').hidden = true;
  document.getElementById('siteListCard').style.display = '';
});

document.getElementById('newSiteGeoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    ui.showToast('Géolocalisation indisponible sur cet appareil');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      newSiteCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      document.getElementById('newSiteGeoStatus').textContent = 'Position GPS enregistrée.';
    },
    (err) => ui.showToast(`Position indisponible (${err.message})`),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.getElementById('saveNewSiteBtn').addEventListener('click', async () => {
  const name = document.getElementById('newSiteName').value.trim();
  if (!name) {
    ui.showToast('Indique un nom de sous-station');
    return;
  }
  if (ui.findSubstationByName(name)) {
    ui.showToast('Une sous-station porte déjà ce nom');
    return;
  }
  const substation = {
    id: `SUB_${Date.now()}`,
    name,
    lat: newSiteCoords?.lat ?? null,
    lon: newSiteCoords?.lon ?? null,
    notes_acces: document.getElementById('newSiteNotes').value.trim(),
    needs_review: !newSiteCoords,
    photos: [],
    comments: [],
    detailLoaded: true,
  };
  state.substations.push(substation);
  await dbLayer.put('substations', substation);
  await dbLayer.queueSync('substation', 'upsert', substation);
  ui.renderSubstationDatalist();
  ui.renderSiteList(document.getElementById('siteSearch').value);
  document.getElementById('addSiteForm').hidden = true;
  renderMarkers(state.substations, (id) => {
    const s = state.substations.find((x) => x.id === id);
    if (s) {
      document.getElementById('rondeSubstation').value = s.name;
      onSubstationInput();
    }
  });
  ui.showToast('Sous-station créée');
  ui.selectSite(substation.id);
});

// ===== CONTRÔLES =====
// Une photo prise directement avec l'appareil (pas depuis la galerie) pèse
// souvent plusieurs Mo en taille native. Stockée telle quelle (en base64,
// donc encore +33%) dans IndexedDB puis renvoyée telle quelle au serveur à
// chaque synchro, ça ralentit tout à la fois : le démarrage de l'appli (des
// Mo à recharger depuis IndexedDB), l'affichage des galeries (des <img>
// énormes à décoder), et la synchro elle-même sur un réseau de sous-sol déjà
// faible. Redimensionner et recompresser avant stockage règle les trois
// d'un coup, avec une perte de qualité invisible pour de la documentation
// d'intervention. Utilisé pour tous les points d'entrée photo (contrôles,
// avant/après, fiches, sites) puisqu'ils passent tous par cette fonction.
const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.75;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= MAX_PHOTO_DIMENSION && height <= MAX_PHOTO_DIMENSION) {
          // Déjà assez petite (déjà compressée, capture d'écran...) : inutile
          // de repasser par un canvas, on garde l'original tel quel.
          resolve(reader.result);
          return;
        }
        const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // évite un fond noir si l'original a une transparence (PNG)
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
      };
      img.onerror = () => resolve(reader.result); // image illisible par le canvas : on garde l'original plutôt que de bloquer
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== BROUILLON DE RONDE (anti-perte) =====
// state.controls/rondeStatut/observations ne sont écrits en base qu'au clic
// sur "Archiver la ronde" — un rechargement de page avant ça (mise à jour de
// l'appli, appli tuée en arrière-plan par l'OS, coupure réseau pendant une
// saisie...) perdait tout le travail en cours, sans aucun moyen de le
// récupérer : rien n'existait encore nulle part, ni en local ni sur le
// serveur. Un brouillon est maintenant sauvegardé en continu dans
// localStorage (synchrone, survit à un rechargement immédiatement) et
// restauré au prochain chargement tant que la ronde n'a pas été réellement
// archivée.
const RONDE_DRAFT_KEY = 'ronde_draft_v6';

function saveRondeDraft() {
  try {
    localStorage.setItem(
      RONDE_DRAFT_KEY,
      JSON.stringify({
        substation: document.getElementById('rondeSubstation').value,
        tech: document.getElementById('rondeTech').value,
        observations: document.getElementById('rondeObservations').value,
        controls: state.controls,
        rondeStatut: state.rondeStatut,
      })
    );
  } catch {
    // Quota localStorage dépassé (beaucoup de photos non compressées en
    // cours) : tant pis pour le brouillon, pas pire qu'avant ce correctif.
  }
}

function clearRondeDraft() {
  localStorage.removeItem(RONDE_DRAFT_KEY);
}

function restoreRondeDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(RONDE_DRAFT_KEY) || 'null');
  } catch {
    draft = null;
  }
  if (!draft) return;
  document.getElementById('rondeSubstation').value = draft.substation || '';
  if (draft.tech) document.getElementById('rondeTech').value = draft.tech;
  document.getElementById('rondeObservations').value = draft.observations || '';
  if (Array.isArray(draft.controls) && draft.controls.length === state.controls.length) {
    state.controls = draft.controls;
  }
  if (draft.rondeStatut) state.rondeStatut = draft.rondeStatut;
  onSubstationInput();
  ui.renderControls();
  ui.renderRondeStatut();
  ui.showToast('Ronde en cours restaurée (travail non archivé récupéré)');
}

document.getElementById('rondeObservations').addEventListener('input', saveRondeDraft);
document.getElementById('rondeTech').addEventListener('input', saveRondeDraft);

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
    saveRondeDraft();
    return;
  }
  const removePhotoBtn = e.target.closest('[data-action="remove-photo"]');
  if (removePhotoBtn) {
    state.controls[Number(removePhotoBtn.dataset.index)].photo = null;
    ui.renderControls();
    saveRondeDraft();
    return;
  }
  const removePhotoApresBtn = e.target.closest('[data-action="remove-photo-apres"]');
  if (removePhotoApresBtn) {
    state.controls[Number(removePhotoApresBtn.dataset.index)].photoApres = null;
    ui.renderControls();
    saveRondeDraft();
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
      tech: `${state.user.prenom} ${state.user.nom}`.trim(),
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
  saveRondeDraft();
});

document.getElementById('controlsList').addEventListener('change', async (e) => {
  const fileInput = e.target.closest('[data-action="set-photo"]');
  if (fileInput && fileInput.files[0]) {
    const dataUrl = await fileToDataUrl(fileInput.files[0]);
    state.controls[Number(fileInput.dataset.index)].photo = dataUrl;
    ui.renderControls();
    saveRondeDraft();
    return;
  }
  const fileInputApres = e.target.closest('[data-action="set-photo-apres"]');
  if (fileInputApres && fileInputApres.files[0]) {
    const dataUrl = await fileToDataUrl(fileInputApres.files[0]);
    state.controls[Number(fileInputApres.dataset.index)].photoApres = dataUrl;
    ui.renderControls();
    saveRondeDraft();
  }
});

// ===== STATUT À L'ISSUE =====
document.getElementById('rondeStatutChoices').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-statut"]');
  if (!btn) return;
  state.rondeStatut = btn.dataset.statut;
  ui.renderRondeStatut();
  saveRondeDraft();
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
      tech: `${state.user.prenom} ${state.user.nom}`.trim(),
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
  clearRondeDraft();
  ui.renderControls();
  ui.renderRondeStatut();
  ui.renderBilan();
  ui.renderBilanStats();
  ui.renderBilanTrend();
  ui.renderPointsRecurrents();
  ui.renderSitesASurveiller();
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
  const substation = ui.findSubstationByName(document.getElementById('rondeSubstation').value);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-9999px; top:0; width:780px;';
  container.innerHTML = ui.buildRondeReportHtml({
    substation,
    tech: document.getElementById('rondeTech').value,
    date: document.getElementById('rondeDate').value,
    heure: document.getElementById('rondeHeure').value,
    observations: document.getElementById('rondeObservations').value,
  });
  document.body.appendChild(container);
  html2pdf()
    .set({
      margin: 10,
      filename: `Ronde_${(substation ? substation.name : 'site').replace(/\s+/g, '_')}_${Date.now()}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
    })
    .from(container)
    .save()
    .then(() => container.remove());
});

// ===== FICHES =====
// Formulaire unique pour créer une fiche ou enrichir une fiche existante
// (y compris une fiche de référence) — la base de connaissances est pensée
// comme un outil collaboratif qui s'enrichit avec l'expérience terrain.
const FICHE_FORM_FIELDS = {
  ficheUrgence: 'urgence',
  ficheSymptomes: 'symptomes',
  ficheCause: 'cause_probable',
  ficheProcedure: 'procedure_intervention',
  ficheSecurite: 'securite',
  ficheOutillage: 'outillage',
  fichePieces: 'pieces_rechange',
  ficheSolution: 'solution',
};
let ficheFormPhotos = [];
let editingFicheId = null;

// ===== BROUILLON DE FICHE (anti-perte) =====
// Même risque que la ronde/MES corrigé la veille : le formulaire fiche
// (titre + 8 champs + photos) peut prendre du temps à remplir sur le
// terrain, mais rien n'est écrit en base avant le clic sur "Enregistrer".
const FICHE_DRAFT_KEY = 'fiche_draft_v6';

function saveFicheDraft() {
  try {
    const fields = {};
    Object.keys(FICHE_FORM_FIELDS).forEach((elId) => (fields[elId] = document.getElementById(elId).value));
    localStorage.setItem(
      FICHE_DRAFT_KEY,
      JSON.stringify({
        title: document.getElementById('ficheTitle').value,
        fields,
        photos: ficheFormPhotos,
        editingFicheId,
      })
    );
  } catch {
    // Quota localStorage dépassé : tant pis pour le brouillon.
  }
}

function clearFicheDraft() {
  localStorage.removeItem(FICHE_DRAFT_KEY);
}

function restoreFicheDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(FICHE_DRAFT_KEY) || 'null');
  } catch {
    draft = null;
  }
  if (!draft || (!draft.title && !Object.values(draft.fields || {}).some(Boolean) && !(draft.photos || []).length)) return;

  editingFicheId = draft.editingFicheId || null;
  document.getElementById('ficheTitle').value = draft.title || '';
  Object.keys(FICHE_FORM_FIELDS).forEach((elId) => {
    document.getElementById(elId).value = (draft.fields && draft.fields[elId]) || '';
  });
  ficheFormPhotos = draft.photos || [];
  ui.renderFicheFormPhotos(ficheFormPhotos);
  document.getElementById('addFicheCardTitle').textContent = editingFicheId ? 'Modifier la fiche' : 'Nouvelle fiche';
  document.getElementById('addFicheBtn').textContent = editingFicheId ? 'Enregistrer les modifications' : 'Enregistrer la fiche';
  document.getElementById('cancelFicheEditBtn').hidden = !editingFicheId;
  document.getElementById('addFicheCard').hidden = false;
  ui.showToast('Fiche en cours restaurée (travail non enregistré récupéré)');
}

function resetFicheForm() {
  document.getElementById('ficheTitle').value = '';
  Object.keys(FICHE_FORM_FIELDS).forEach((id) => (document.getElementById(id).value = ''));
  ficheFormPhotos = [];
  ui.renderFicheFormPhotos(ficheFormPhotos);
  editingFicheId = null;
  document.getElementById('addFicheCardTitle').textContent = 'Nouvelle fiche';
  document.getElementById('addFicheBtn').textContent = 'Enregistrer la fiche';
  document.getElementById('cancelFicheEditBtn').hidden = true;
  // Toujours vider le brouillon en même temps que le formulaire : les trois
  // appelants (nouvelle fiche depuis zéro, annulation, sauvegarde réussie)
  // signifient tous "abandonner l'état actuel du formulaire".
  clearFicheDraft();
}

function openFicheFormForEdit(fiche) {
  editingFicheId = fiche.id;
  document.getElementById('ficheTitle').value = fiche.title || '';
  Object.entries(FICHE_FORM_FIELDS).forEach(([elId, field]) => {
    document.getElementById(elId).value = fiche[field] || '';
  });
  ficheFormPhotos = (fiche.photos || []).map((p) => ({ ...p }));
  ui.renderFicheFormPhotos(ficheFormPhotos);
  document.getElementById('addFicheCardTitle').textContent = 'Modifier la fiche';
  document.getElementById('addFicheBtn').textContent = 'Enregistrer les modifications';
  document.getElementById('cancelFicheEditBtn').hidden = false;
  document.getElementById('addFicheCard').hidden = false;
  document.getElementById('addFicheCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Snapshot immédiat : un rechargement juste après avoir ouvert l'édition
  // (avant la moindre frappe) doit retrouver CETTE fiche en cours de
  // modification, pas un éventuel brouillon différent resté d'avant.
  saveFicheDraft();
}

document.getElementById('toggleAddFicheBtn').addEventListener('click', () => {
  const card = document.getElementById('addFicheCard');
  if (card.hidden) {
    resetFicheForm();
    card.hidden = false;
    document.getElementById('ficheTitle').focus();
  } else {
    card.hidden = true;
  }
});

document.getElementById('cancelFicheEditBtn').addEventListener('click', () => {
  resetFicheForm();
  document.getElementById('addFicheCard').hidden = true;
});

// Titre + les 8 champs texte du formulaire déclenchent tous un brouillon via
// cette écoute déléguée sur le conteneur (couvre aussi le <select> urgence).
document.getElementById('addFicheCard').addEventListener('input', saveFicheDraft);
document.getElementById('addFicheCard').addEventListener('change', saveFicheDraft);

document.getElementById('fichePhotoInput').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  const dataUrl = await fileToDataUrl(e.target.files[0]);
  ficheFormPhotos.push({ id: `PHOTO_${Date.now()}`, url: dataUrl });
  ui.renderFicheFormPhotos(ficheFormPhotos);
  e.target.value = '';
  saveFicheDraft();
});

document.getElementById('ficheFormPhotoRow').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-fiche-form-photo"]');
  if (!btn) return;
  ficheFormPhotos = ficheFormPhotos.filter((p) => p.id !== btn.dataset.photoId);
  ui.renderFicheFormPhotos(ficheFormPhotos);
  saveFicheDraft();
});

document.getElementById('addFicheBtn').addEventListener('click', async () => {
  const title = document.getElementById('ficheTitle').value.trim();
  if (!title) {
    ui.showToast('Le titre est requis');
    return;
  }
  const fields = {};
  Object.entries(FICHE_FORM_FIELDS).forEach(([elId, field]) => {
    fields[field] = document.getElementById(elId).value.trim();
  });

  if (editingFicheId) {
    const fiche = state.fiches.find((f) => f.id === editingFicheId);
    if (fiche) {
      Object.assign(fiche, fields, { title, photos: ficheFormPhotos });
      await dbLayer.put('fiches', fiche);
      await dbLayer.queueSync('fiche', 'upsert', fiche);
      ui.showToast('Fiche mise à jour');
    }
  } else {
    const fiche = {
      id: `FICHE_${Date.now()}`,
      title,
      ...fields,
      photos: ficheFormPhotos,
      is_reference: false,
      date: new Date().toLocaleString('fr-FR'),
      ts: Date.now(),
    };
    await dbLayer.put('fiches', fiche);
    await dbLayer.queueSync('fiche', 'upsert', fiche);
    state.fiches.push(fiche);
    ui.showToast('Fiche ajoutée');
  }

  resetFicheForm();
  document.getElementById('addFicheCard').hidden = true;
  ui.renderFiches(document.getElementById('ficheSearch').value);
  ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
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
  const editBtn = e.target.closest('[data-action="edit-fiche"]');
  if (editBtn) {
    const fiche = ui.getFicheById(editBtn.dataset.id);
    if (fiche) openFicheFormForEdit(fiche);
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
  // Le formulaire "Nouvelle action" n'a pas de champ de sélection de site :
  // cette action n'est donc rattachée à aucun site. Avant, elle récupérait
  // silencieusement le nom tapé dans le champ "Sous-station" de l'onglet
  // Ronde — resté rempli d'une visite précédente, ou en cours de saisie
  // pour tout autre chose — attribuant l'action à un site qui n'avait
  // souvent aucun rapport avec elle.
  const action = {
    id: `ACTION_${Date.now()}`,
    substation_id: null,
    text,
    severity: document.getElementById('actionSeverity').value,
    source: 'manuelle',
    photo: null,
    done: false,
    tech: `${state.user.prenom} ${state.user.nom}`.trim(),
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
    return;
  }
  // La case à cocher a son propre gestionnaire sur l'événement 'change' :
  // ici on se contente de ne pas la laisser déplier/replier le détail en
  // plus de cocher.
  if (e.target.closest('[data-action="toggle-action"]')) return;
  const gotoSite = e.target.closest('[data-action="goto-action-site"]');
  if (gotoSite) {
    ui.switchTab('sites');
    ui.renderSiteList();
    ui.selectSite(gotoSite.dataset.siteId);
    loadSiteDetailIfNeeded(gotoSite.dataset.siteId);
    return;
  }
  const item = e.target.closest('[data-action="toggle-action-detail"]');
  if (item) ui.toggleActionDetail(item.dataset.id);
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
// ===== BROUILLON DE SESSION MES (anti-perte) =====
// Même raisonnement que le brouillon de ronde : les 41 points de contrôle et
// les paramètres de poste peuvent prendre du temps à renseigner sur place,
// et rien n'était sauvegardé avant le clic final sur "Enregistrer" — un
// rechargement entre-temps perdait tout.
const MES_DRAFT_KEY = 'mes_draft_v6';

function saveMesDraft() {
  try {
    localStorage.setItem(
      MES_DRAFT_KEY,
      JSON.stringify({
        substation: document.getElementById('mesSubstation').value,
        intervenant: document.getElementById('mesIntervenant').value,
        notes: document.getElementById('mesNotes').value,
        checks: state.mesChecks,
        poste: state.mesPoste,
      })
    );
  } catch {
    // Quota localStorage dépassé : tant pis pour le brouillon.
  }
}

function clearMesDraft() {
  localStorage.removeItem(MES_DRAFT_KEY);
}

function restoreMesDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(MES_DRAFT_KEY) || 'null');
  } catch {
    draft = null;
  }
  if (!draft) return;
  document.getElementById('mesSubstation').value = draft.substation || '';
  if (draft.intervenant) document.getElementById('mesIntervenant').value = draft.intervenant;
  document.getElementById('mesNotes').value = draft.notes || '';
  if (Array.isArray(draft.checks) && draft.checks.length === state.mesChecks.length) {
    state.mesChecks = draft.checks;
  }
  if (draft.poste && Array.isArray(draft.poste.echangeurs) && draft.poste.echangeurs.length > 0) {
    state.mesPoste = draft.poste;
  }
  document.getElementById('mesNbEchangeurs').value = state.mesPoste.echangeurs.length;
  ui.renderMesChecks();
  ui.renderMesCasPosteSelect();
  ui.renderMesEchangeurs();
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
  ui.showToast('Session MES en cours restaurée (travail non enregistré récupéré)');
}

document.getElementById('mesSubstation').addEventListener('input', saveMesDraft);
document.getElementById('mesIntervenant').addEventListener('input', saveMesDraft);
document.getElementById('mesNotes').addEventListener('input', saveMesDraft);

document.getElementById('mesChecksList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="set-mes-status"]');
  if (!btn) return;
  state.mesChecks[Number(btn.dataset.index)].status = btn.dataset.status;
  ui.renderMesChecks();
  saveMesDraft();
});

document.getElementById('mesChecksList').addEventListener('input', (e) => {
  const valueField = e.target.closest('[data-action="set-mes-value"]');
  if (valueField) {
    const index = Number(valueField.dataset.index);
    state.mesChecks[index].valeur = valueField.value;
    ui.updateDeviationHint(index);
    saveMesDraft();
    return;
  }
  const commentField = e.target.closest('[data-action="set-mes-comment"]');
  if (commentField) {
    state.mesChecks[Number(commentField.dataset.index)].commentaire = commentField.value;
    saveMesDraft();
  }
});

// ===== MES : identification du poste =====
document.getElementById('mesCasPoste').addEventListener('change', (e) => {
  state.mesPoste.cas_poste = e.target.value;
  saveMesDraft();
});

document.getElementById('mesRepresentantClient').addEventListener('input', (e) => {
  state.mesPoste.representant_client = e.target.value;
  saveMesDraft();
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
  saveMesDraft();
});

document.getElementById('mesEchangeursList').addEventListener('input', (e) => {
  const field = e.target.closest('[data-action="set-echangeur"]');
  if (!field) return;
  state.mesPoste.echangeurs[Number(field.dataset.index)][field.dataset.field] = field.value;
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
  saveMesDraft();
});
document.getElementById('mesEchangeursList').addEventListener('change', (e) => {
  const field = e.target.closest('[data-action="set-echangeur"]');
  if (!field) return;
  state.mesPoste.echangeurs[Number(field.dataset.index)][field.dataset.field] = field.value;
  ui.renderMesNominalRecap();
  ui.refreshAllDeviationHints();
  saveMesDraft();
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
    tech: `${state.user.prenom} ${state.user.nom}`.trim(),
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
  clearMesDraft();
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

  if (action === 'load-more-historique') {
    ui.loadMoreHistorique();
    ui.renderHistorique(histFilter, document.getElementById('histSearch').value);
    return;
  } else if (action === 'delete-ronde') {
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
  const STATUT_LABEL = { operationnel: 'Opérationnel', reserve: 'Opérationnel avec réserve', arret: 'Arrêt / intervention requise' };
  const rondesSorted = state.rondes.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const rondeHeaders = ['Date', 'Heure', 'Sous-station', 'Intervenant', 'Statut', "Nb d'anomalies", 'Anomalies', 'Observations'];
  const rondeRows = rondesSorted.map((r) => {
    const substation = state.substations.find((s) => s.id === r.substation_id);
    const anomalies = (r.controls || []).filter((c) => c.status === 'warning' || c.status === 'danger');
    return [
      r.date || '', r.heure || '', substation ? substation.name : r.substation_id, r.tech || '',
      STATUT_LABEL[r.statut] || r.statut || '', anomalies.length,
      anomalies.map((a) => a.label).join(', '), r.observations || '',
    ];
  });
  const rondeSheet = XLSX.utils.aoa_to_sheet([
    [`Historique des rondes — Ronde V6 IDEX · exporté le ${new Date().toLocaleString('fr-FR')}`],
    [`${rondesSorted.length} ronde(s)`],
    [],
    rondeHeaders,
    ...rondeRows,
  ]);
  rondeSheet['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 34 }, { wch: 45 }];
  rondeSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: rondeHeaders.length - 1 } }];
  rondeSheet['!autofilter'] = { ref: `A4:${String.fromCharCode(65 + rondeHeaders.length - 1)}${4 + rondeRows.length}` };
  rondeSheet['!freeze'] = { xSplit: 0, ySplit: 4 };

  const SEVERITY_LABEL = { danger: 'Urgent', warning: 'À surveiller', none: 'Info' };
  const actionHeaders = ['Statut', 'Gravité', 'Sous-station', 'Description', 'Intervenant', 'Date', 'Origine'];
  const actionRows = state.actions.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).map((a) => {
    const substation = state.substations.find((s) => s.id === a.substation_id);
    return [
      a.done ? 'Traitée' : 'En attente', SEVERITY_LABEL[a.severity] || a.severity || '',
      substation ? substation.name : (a.substation_id || ''), a.text || '', a.tech || '', a.date || '',
      a.source === 'ronde' ? 'Ronde' : 'Manuelle',
    ];
  });
  const actionSheet = XLSX.utils.aoa_to_sheet([
    [`Actions — Ronde V6 IDEX · exporté le ${new Date().toLocaleString('fr-FR')}`],
    [`${actionRows.length} action(s)`],
    [],
    actionHeaders,
    ...actionRows,
  ]);
  actionSheet['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 45 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
  actionSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: actionHeaders.length - 1 } }];
  actionSheet['!autofilter'] = { ref: `A4:${String.fromCharCode(65 + actionHeaders.length - 1)}${4 + actionRows.length}` };
  actionSheet['!freeze'] = { xSplit: 0, ySplit: 4 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, rondeSheet, 'Rondes');
  XLSX.utils.book_append_sheet(workbook, actionSheet, 'Actions');
  XLSX.writeFile(workbook, `Historique_Ronde_V6_${Date.now()}.xlsx`);
});

// Limite le nombre de requêtes en parallèle (140 sites -> pas question de
// tirer 140 fetch simultanés au clic sur "Sauvegarder").
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

document.getElementById('exportBackupBtn').addEventListener('click', async () => {
  const exportBtn = document.getElementById('exportBackupBtn');
  exportBtn.disabled = true;
  ui.showToast('Préparation de la sauvegarde (récupération des photos)...');
  try {
    const substations = await dbLayer.getAll('substations');
    // La liste locale ne contient les photos/commentaires QUE pour les sites
    // déjà ouverts sur cet appareil (chargement à la demande — voir
    // loadSiteDetailIfNeeded) : sans ce complément, "Sauvegarder toutes les
    // données" oublierait les photos de tous les sites jamais visités depuis
    // ce téléphone, ce qui n'a rien d'une sauvegarde complète.
    const completeSubstations = await mapWithConcurrency(substations, 6, async (s) => {
      if (s.photos !== undefined && s.comments !== undefined) return s;
      try {
        const detail = await api.fetchSubstationDetail(s.id);
        return { ...s, photos: detail.photos || [], comments: detail.comments || [] };
      } catch {
        return s; // hors-ligne : on sauvegarde ce qu'on a localement pour ce site
      }
    });

    const backup = {
      version: 1,
      exported_at: new Date().toISOString(),
      substations: completeSubstations,
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
    ui.showToast('Sauvegarde téléchargée (avec toutes les photos)');
  } finally {
    exportBtn.disabled = false;
  }
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
          if (store === 'substations') {
            // L'upsert 'substation' n'écrit plus photos_json/comments_json
            // (voir api/sync.js — gérés en opérations ciblées pour ne jamais
            // écraser l'ajout d'un collègue). Sans ça, importer une
            // sauvegarde ne renverrait jamais ses photos/commentaires au
            // serveur : l'import aurait l'air de marcher en local, mais rien
            // ne serait vraiment restauré côté serveur. Le dédoublonnage par
            // id côté serveur rend cette réémission sans risque pour ce qui
            // est déjà synchronisé.
            for (const photo of item.photos || []) {
              await dbLayer.queueSync('substation_photo', 'add', { substation_id: item.id, photo });
            }
            for (const comment of item.comments || []) {
              await dbLayer.queueSync('substation_comment', 'add', { substation_id: item.id, comment });
            }
          }
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
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-9999px; top:0; width:780px;';
  container.innerHTML = ui.buildWeeklyReportHtml();
  document.body.appendChild(container);
  html2pdf()
    .set({
      margin: 10,
      filename: `Rapport_hebdo_${Date.now()}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
    })
    .from(container)
    .save()
    .then(() => container.remove());
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
