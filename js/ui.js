import { state, URGENCE_LABEL, CAS_POSTE_TYPES, RONDE_STATUTS } from './state.js';
import { icon } from './icons.js';

// Rondes/actions/MES sont partagées entre techniciens (visibilité d'équipe) ;
// un enregistrement pas encore synchronisé n'a pas encore de user_id assigné
// par le serveur, on le traite comme le sien tant qu'il n'a pas été prouvé
// appartenir à quelqu'un d'autre.
function isOwned(item) {
  return !item.user_id || item.user_id === state.user?.id;
}

// sticky: reste affiché jusqu'à ce qu'on tape dessus, au lieu de disparaître
// tout seul après 2.6s — pour un message qu'on a besoin de lire en entier ou
// de capturer en photo (ex : détail d'une erreur de synchro), pas juste une
// confirmation éphémère.
export function showToast(message, { sticky = false } = {}) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  if (sticky) {
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => toast.remove());
  } else {
    setTimeout(() => toast.remove(), 2600);
  }
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    if (active) t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${tab}`));
  state.currentTab = tab;
}

// ===== SOUS-STATIONS =====
export function findSubstationByName(name) {
  const needle = (name || '').trim().toLowerCase();
  if (!needle) return null;
  return state.substations.find((s) => s.name.trim().toLowerCase() === needle) || null;
}

export function renderSubstationDatalist() {
  const datalist = document.getElementById('substationsDatalist');
  datalist.innerHTML = state.substations
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((s) => `<option value="${escapeHtml(s.name)}">`)
    .join('');
}

export function renderAccessNotes(substation) {
  const group = document.getElementById('accessNotesGroup');
  const text = document.getElementById('accessNotesText');
  if (!substation || (!substation.notes_acces && !substation.needs_review)) {
    group.style.display = 'none';
    return;
  }
  group.style.display = 'block';
  const parts = [];
  if (substation.needs_review) parts.push('<span class="badge review">Position à vérifier</span>');
  if (substation.notes_acces) parts.push(escapeHtml(substation.notes_acces));
  text.innerHTML = parts.join('<br>');
}

// ===== CONTRÔLES =====
const STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'sur', 'sous',
  'dans', 'pour', 'avec', 'sans', 'ou', 'est', 'etat', 'absence', 'niveau', 'presence', 'anormal',
  'anormale', 'anormaux', 'general', 'generale',
]);

function normWord(w) {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}

function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(normWord)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Rapproche un contrôle en anomalie des fiches défaut existantes par recoupement
// de mots-clés (label + commentaire technicien vs titre + cause probable de la
// fiche). Approximatif mais évite d'aller chercher manuellement dans l'onglet
// Fiches pendant la ronde.
export function matchFichesForControl(ctrl) {
  const needle = new Set(tokenize(`${ctrl.label} ${ctrl.comment || ''}`));
  if (needle.size === 0) return [];
  const scored = state.fiches
    .map((f) => {
      const hay = tokenize(`${f.title} ${f.cause_probable || ''}`);
      const score = hay.reduce((n, w) => n + (needle.has(w) ? 1 : 0), 0);
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 2).map((x) => x.f);
}

// Rafraîchit uniquement le bloc de suggestions d'un contrôle (appelé à chaque
// frappe dans le commentaire) sans re-render la liste entière — évite de
// perdre le focus du textarea en cours de saisie.
export function updateFicheSuggestions(index) {
  const el = document.querySelector(`[data-suggest-index="${index}"]`);
  if (!el) return;
  const ctrl = state.controls[index];
  el.innerHTML = renderFicheSuggestions(matchFichesForControl(ctrl));
}

function renderFicheSuggestions(fiches) {
  if (!fiches.length) return '';
  return `<div class="fiche-suggest">
    <div class="fiche-suggest-label">${icon('search', 12)} Fiche(s) proche(s)</div>
    ${fiches
      .map(
        (f) => `<div class="fiche-suggest-item">
          <strong>${escapeHtml(f.title)}</strong>
          ${f.cause_probable ? `<span>${escapeHtml(f.cause_probable)}</span>` : ''}
          ${f.solution ? `<span class="solution">→ ${escapeHtml(f.solution)}</span>` : ''}
        </div>`
      )
      .join('')}
  </div>`;
}

export function renderControls() {
  const list = document.getElementById('controlsList');
  list.innerHTML = state.controls
    .map(
      (ctrl, i) => `
    <div class="check-item">
      <div class="check-header">${escapeHtml(ctrl.label)}</div>
      <div class="check-buttons">
        <button class="check-btn ok ${ctrl.status === 'ok' ? 'sel' : ''}" data-action="set-status" data-index="${i}" data-status="ok">OK</button>
        <button class="check-btn warning ${ctrl.status === 'warning' ? 'sel' : ''}" data-action="set-status" data-index="${i}" data-status="warning">Dégradé</button>
        <button class="check-btn danger ${ctrl.status === 'danger' ? 'sel' : ''}" data-action="set-status" data-index="${i}" data-status="danger">Défaillant</button>
        <button class="check-btn na ${ctrl.status === 'na' ? 'sel' : ''}" data-action="set-status" data-index="${i}" data-status="na">N/A</button>
      </div>
      ${
        ctrl.status && ctrl.status !== 'ok' && ctrl.status !== 'na'
          ? `<textarea class="check-comment" placeholder="Commentaire..." data-action="set-comment" data-index="${i}">${escapeHtml(ctrl.comment)}</textarea>
             <div data-suggest-index="${i}">${renderFicheSuggestions(matchFichesForControl(ctrl))}</div>
             <div class="photo-row">
               <label class="photo-btn">${icon('camera', 14)} Avant<input type="file" accept="image/*" data-action="set-photo" data-index="${i}"></label>
               ${ctrl.photo ? `<div class="photo-thumb"><img src="${ctrl.photo}"><button class="remove-photo" data-action="remove-photo" data-index="${i}">${icon('xCircle', 11)}</button></div>` : ''}
               <label class="photo-btn">${icon('camera', 14)} Après<input type="file" accept="image/*" data-action="set-photo-apres" data-index="${i}"></label>
               ${ctrl.photoApres ? `<div class="photo-thumb"><img src="${ctrl.photoApres}"><button class="remove-photo" data-action="remove-photo-apres" data-index="${i}">${icon('xCircle', 11)}</button></div>` : ''}
             </div>
             <button class="btn-secondary" style="width:100%; margin-top:8px; ${ctrl.actionCreated ? 'opacity:.5;' : ''}" data-action="create-action-inline" data-index="${i}" ${ctrl.actionCreated ? 'disabled' : ''}>
               ${ctrl.actionCreated ? icon('check', 13) + ' Action corrective créée' : icon('plus', 13) + ' Créer une action corrective pour ce point'}
             </button>`
          : ''
      }
    </div>`
    )
    .join('');
}

// ===== STATUT À L'ISSUE =====
const STATUT_ICON = { operationnel: 'check', reserve: 'alertTriangle', arret: 'xCircle' };

export function renderRondeStatut() {
  const el = document.getElementById('rondeStatutChoices');
  el.innerHTML = RONDE_STATUTS.map(
    (s) => `<button class="statut-btn ${state.rondeStatut === s.id ? 'sel ' + s.id : ''}" data-action="set-statut" data-statut="${s.id}">
      ${icon(STATUT_ICON[s.id])} ${escapeHtml(s.label)}
    </button>`
  ).join('');
}

// ===== BILAN =====
export function renderBilan() {
  const content = document.getElementById('bilanContent');
  const total = state.controls.length;
  const completed = state.controls.filter((c) => c.status).length;
  const ok = state.controls.filter((c) => c.status === 'ok').length;
  const issues = state.controls.filter((c) => c.status === 'warning' || c.status === 'danger');
  const completeness = total ? Math.round((completed / total) * 100) : 0;

  content.innerHTML = `
    <div class="alert ${issues.length ? 'warning' : 'success'}">
      Complétude : ${completeness}% · OK : ${ok}/${total} · Anomalies : ${issues.length}
    </div>
    ${
      issues.length
        ? issues
            .map(
              (i) => `<div class="alert ${i.status === 'danger' ? 'danger' : 'warning'}">
              <strong>${escapeHtml(i.label)}</strong>${i.comment ? `<br>${escapeHtml(i.comment)}` : ''}
            </div>`
            )
            .join('')
        : ''
    }
  `;
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

// Sous-stations/rondes/actions dont sont composés les compteurs du bilan :
// tapoter une tuile déplie le détail des éléments comptés, pour ne pas avoir
// à deviner ce qui se cache derrière un simple nombre.
let expandedStatTileKey = null;

export function toggleStatTile(key) {
  expandedStatTileKey = expandedStatTileKey === key ? null : key;
  renderBilanStats();
}

function siteRowsDetail(ids, rondes) {
  const rows = Array.from(ids)
    .map((id) => {
      const rondesForSite = rondes
        .filter((r) => r.substation_id === id)
        .sort((a, b) => `${b.date || ''}${b.heure || ''}`.localeCompare(`${a.date || ''}${a.heure || ''}`));
      const last = rondesForSite[0];
      const substation = state.substations.find((s) => s.id === id);
      return { id, name: substation ? substation.name : null, count: rondesForSite.length, lastDate: last?.date, lastHeure: last?.heure };
    })
    .sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
  return rows
    .map(
      (r) => `<div class="item" ${r.name ? `data-action="goto-site-alert" data-id="${r.id}" style="cursor:pointer;"` : ''}>
        <div class="item-title">${escapeHtml(r.name || 'Site introuvable (supprimé ?)')}</div>
        <div class="item-meta">${r.count} ronde${r.count > 1 ? 's' : ''} · dernière le ${escapeHtml(r.lastDate || '?')}${r.lastHeure ? ` à ${escapeHtml(r.lastHeure)}` : ''}</div>
      </div>`
    )
    .join('');
}

function rondeRowsDetail(rondes) {
  return rondes
    .slice()
    .sort((a, b) => `${b.date || ''}${b.heure || ''}`.localeCompare(`${a.date || ''}${a.heure || ''}`))
    .map((r) => {
      const substation = state.substations.find((s) => s.id === r.substation_id);
      const statut = r.statut || 'operationnel';
      return `<div class="item" ${substation ? `data-action="goto-site-alert" data-id="${substation.id}" style="cursor:pointer;"` : ''}>
        <div class="item-row" style="justify-content:space-between;align-items:center;">
          <div>
            <div class="item-title">${escapeHtml(substation ? substation.name : 'Site introuvable (supprimé ?)')}</div>
            <div class="item-meta">${escapeHtml(r.date || '')}${r.heure ? ` à ${escapeHtml(r.heure)}` : ''}${r.tech ? ` · ${escapeHtml(r.tech)}` : ''}</div>
          </div>
          ${SITE_STATUT_BADGE[statut] || ''}
        </div>
      </div>`;
    })
    .join('');
}

function actionRowsDetail(actions) {
  return actions
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map((a) => {
      const substation = state.substations.find((s) => s.id === a.substation_id);
      return `<div class="item" data-action="goto-stat-action" data-id="${a.id}" style="cursor:pointer;">
        <div class="item-title">
          ${a.severity && a.severity !== 'none' ? `<span class="badge ${a.severity === 'danger' ? 'immediat' : 'a_planifier'}">${a.severity === 'danger' ? 'Urgent' : 'À surveiller'}</span> ` : ''}
          ${escapeHtml(a.text)}
        </div>
        <div class="item-meta">${escapeHtml(a.date || '')}${a.tech ? ` · ${escapeHtml(a.tech)}` : ''}${substation ? ` · ${escapeHtml(substation.name)}` : ''}</div>
      </div>`;
    })
    .join('');
}

export function renderBilanStats() {
  const el = document.getElementById('bilanStats');
  const rondesWeek = state.rondes.filter((r) => isWithinDays(r.date, 7));
  const rondesMonth = state.rondes.filter((r) => isWithinDays(r.date, 30));
  const sstWeekIds = new Set(rondesWeek.map((r) => r.substation_id));
  const sstMonthIds = new Set(rondesMonth.map((r) => r.substation_id));
  const openActionsList = state.actions.filter((a) => !a.done);
  const urgentActionsList = openActionsList.filter((a) => a.severity === 'danger');

  const tiles = [
    { key: 'sstWeek', value: sstWeekIds.size, label: 'Sous-stations vues cette semaine', icon: 'building', detail: () => siteRowsDetail(sstWeekIds, rondesWeek) },
    { key: 'rondesWeek', value: rondesWeek.length, label: 'Rondes cette semaine', icon: 'clipboard', detail: () => rondeRowsDetail(rondesWeek) },
    { key: 'sstMonth', value: sstMonthIds.size, label: 'Sous-stations vues ce mois', icon: 'building', detail: () => siteRowsDetail(sstMonthIds, rondesMonth) },
    { key: 'rondesMonth', value: rondesMonth.length, label: 'Rondes ce mois', icon: 'clipboard', detail: () => rondeRowsDetail(rondesMonth) },
    { key: 'openActions', value: openActionsList.length, label: 'Actions en attente', icon: 'wrench', detail: () => actionRowsDetail(openActionsList) },
    { key: 'urgentActions', value: urgentActionsList.length, label: 'Actions urgentes', icon: 'alertTriangle', danger: urgentActionsList.length > 0, detail: () => actionRowsDetail(urgentActionsList) },
  ];

  const activeTile = tiles.find((t) => t.key === expandedStatTileKey);

  el.innerHTML =
    tiles
      .map(
        (t) => `<div class="stat-tile${t.danger ? ' stat-tile-danger' : ''}${activeTile === t ? ' active' : ''}" data-action="toggle-stat-tile" data-key="${t.key}">
        <div class="stat-tile-icon">${icon(t.icon, 16)}</div>
        <div class="value">${t.value}</div>
        <div class="label">${t.label}</div>
      </div>`
      )
      .join('') +
    (activeTile
      ? `<div class="stat-tile-detail">
          <div class="stat-tile-detail-header">${escapeHtml(activeTile.label)}</div>
          ${activeTile.value === 0 ? '<div class="hint">Rien à afficher.</div>' : activeTile.detail()}
        </div>`
      : '');
}

// ===== DIAGNOSTIC IA =====
export function renderDiagnostic(result) {
  const content = document.getElementById('diagnosticContent');
  if (!result) {
    content.innerHTML = '';
    return;
  }
  const cards = result.diagnostics
    .map(
      (d) => `
    <div class="diag-card">
      <div class="diag-label">
        ${escapeHtml(d.label)}
        <span class="badge ${d.urgence}">${URGENCE_LABEL[d.urgence] || d.urgence}</span>
        ${d.escalade ? '<span class="badge immediat">Escalade</span>' : ''}
      </div>
      <dl>
        <dt>Cause probable</dt><dd>${escapeHtml(d.cause_probable)}</dd>
        <dt>Action</dt><dd>${escapeHtml(d.action_recommandee)}</dd>
      </dl>
    </div>`
    )
    .join('');

  content.innerHTML =
    cards +
    (result.synthese_croisee ? `<div class="alert neutral"><strong>Synthèse croisée</strong><br>${escapeHtml(result.synthese_croisee)}</div>` : '');
}

// ===== FICHES (base de connaissances) =====
// Catégorisation par mots-clés (déduite du contenu, pas de champ en base) —
// sert à parcourir la base comme un catalogue (grille de catégories, puis
// liste au tap), sur le modèle de l'app de référence d'Axel : symptômes/
// composants précis plutôt qu'un seul gros bloc "Hydraulique".
// Mots-clés élargis à partir des vrais textes rencontrés dans les fiches et
// les contrôles de ronde (ENE-64-AFD-530, procédure automate, points MES),
// pour réduire les fiches mal classées dans "Général" faute de correspondance.
const FICHE_CATEGORIES = [
  { key: 'fuites', label: 'Fuites', icon: 'droplet', colorVar: '--cat-hydraulique', softVar: '--cat-hydraulique-soft', keywords: ['fuite', 'fuyard', 'fuyarde', 'joint', 'etancheite', 'raccord', 'purgeur', 'presse-etoupe', 'goutte', 'suintement'] },
  { key: 'pompes', label: 'Pompes', icon: 'gauge', colorVar: '--cat-hydraulique', softVar: '--cat-hydraulique-soft', keywords: ['pompe', 'cavitation', 'roulement', 'amorcage', 'desamorcage', 'bruit', 'vibration'] },
  { key: 'vannes', label: 'Vannes', icon: 'wrench', colorVar: '--cat-hydraulique', softVar: '--cat-hydraulique-soft', keywords: ['vanne', 'grippee', 'grippe', 'manoeuvre', 'graissage', 'actionneur', 'servomoteur'] },
  { key: 'echangeurs', label: 'Échangeurs', icon: 'refresh', colorVar: '--cat-hydraulique', softVar: '--cat-hydraulique-soft', keywords: ['echangeur', 'entartrage', 'performance', 'plaques', 'encrassement'] },
  { key: 'reseau', label: 'Réseau', icon: 'thermometer', colorVar: '--cat-hydraulique', softVar: '--cat-hydraulique-soft', keywords: ['reseau', 'corrosion', 'calorifuge', 'isolation', 'isolant', 'circuit', 'tuyauterie', 'air', 'debit', 'delta', 'purge'] },
  { key: 'electrique', label: 'Électrique / Automate', icon: 'zap', colorVar: '--cat-electrique', softVar: '--cat-electrique-soft', keywords: ['tableau', 'electrique', '24vcc', 'porte', 'automate', 'disjoncteur', 'micrologix', 'chargement', 'parametrage', 'cas_poste', 'ccw'] },
  { key: 'instrumentation', label: 'Instrumentation / Compteurs', icon: 'barChart', colorVar: '--cat-instrumentation', softVar: '--cat-instrumentation-soft', keywords: ['sonde', 'capteur', 'compteur', 'modbus', 'jbus', 'communication', 'pression', 'index', 'kamstrup', 'itron'] },
  { key: 'regulation', label: 'Régulation / GTC', icon: 'monitor', colorVar: '--cat-regulation', softVar: '--cat-regulation-soft', keywords: ['regulation', 'pid', 'consigne', 'oscillation', 'instable', 'gtc', 'temperature', 'loi d\'eau'] },
  { key: 'securite', label: 'Sécurité', icon: 'alertTriangle', colorVar: '--danger', softVar: '--danger-soft', keywords: ['securite', 'pressostat', 'thermostat', 'alarme', 'repli', 'epi', 'consignation'] },
  { key: 'general', label: 'Général', icon: 'building', colorVar: '--text-muted', softVar: '--neutral-soft', keywords: ['proprete', 'local', 'acces'] },
];
const FICHE_CATEGORY_BY_KEY = Object.fromEntries(FICHE_CATEGORIES.map((c) => [c.key, c]));

function classifyFiche(f) {
  const tokens = tokenize(`${f.title} ${f.cause_probable || ''}`);
  let best = null;
  let bestScore = 0;
  FICHE_CATEGORIES.forEach((cat) => {
    const score = tokens.reduce((n, w) => n + (cat.keywords.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  });
  return best ? best.key : 'general';
}

// Repliées par défaut : on ne garde que ce que le technicien a explicitement
// ouvert, pour que la liste reste un repérage visuel rapide (icône + couleur
// + titre) plutôt qu'un mur de texte à faire défiler.
const expandedFicheIds = new Set();

export function toggleFicheExpanded(id) {
  if (expandedFicheIds.has(id)) expandedFicheIds.delete(id);
  else expandedFicheIds.add(id);
}

// Niveau du catalogue actuellement affiché : null = grille des catégories,
// 'toutes' = liste complète, ou une clé de FICHE_CATEGORIES = liste filtrée.
let ficheCatalogView = null;

export function openFicheCategory(key) {
  ficheCatalogView = key;
}

export function backToFicheCatalog() {
  ficheCatalogView = null;
}

export function getFicheCatalogView() {
  return ficheCatalogView;
}

export function getFicheById(id) {
  return state.fiches.find((f) => f.id === id) || null;
}

export function renderFicheFormPhotos(photos) {
  const row = document.getElementById('ficheFormPhotoRow');
  const addLabel = row.querySelector('label');
  row.querySelectorAll('.photo-thumb').forEach((el) => el.remove());
  photos.forEach((p) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `<img src="${p.url}"><button class="remove-photo" data-action="remove-fiche-form-photo" data-photo-id="${p.id}">${icon('xCircle', 11)}</button>`;
    row.insertBefore(thumb, addLabel);
  });
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n).trim()}…` : str;
}

const URGENCE_BADGE_CLASS = { immediat: 'immediat', a_planifier: 'a_planifier', a_surveiller: 'a_surveiller' };

function renderProcedureSteps(text) {
  const steps = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return '';
  return `<ol class="fiche-procedure">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
}

function renderFicheTile(f, autoExpand) {
  const cat = FICHE_CATEGORY_BY_KEY[classifyFiche(f)];
  const isExpanded = autoExpand || expandedFicheIds.has(f.id);
  const preview = truncate(f.symptomes || f.cause_probable || f.solution || '', 78);
  return `
    <div class="fiche-tile ${isExpanded ? 'expanded' : ''}" style="--cat-color:var(${cat.colorVar});--cat-soft:var(${cat.softVar});" data-action="toggle-fiche" data-id="${f.id}">
      <div class="fiche-tile-row">
        <div class="fiche-tile-icon">${icon(cat.icon, 17)}</div>
        <div class="fiche-tile-body">
          <div class="fiche-tile-title">
            ${escapeHtml(f.title)}
            ${!f.is_reference ? '<span class="badge a_surveiller">Perso</span>' : ''}
            ${f.urgence && URGENCE_BADGE_CLASS[f.urgence] ? `<span class="badge ${URGENCE_BADGE_CLASS[f.urgence]}">${escapeHtml(URGENCE_LABEL[f.urgence] || f.urgence)}</span>` : ''}
          </div>
          ${preview && !isExpanded ? `<div class="fiche-tile-preview">${escapeHtml(preview)}</div>` : ''}
        </div>
        <div class="fiche-tile-chevron">${icon('chevronDown', 16)}</div>
      </div>
      ${
        isExpanded
          ? `<div class="fiche-tile-detail">
              ${f.symptomes ? `<div class="fiche-block"><div class="fiche-block-label">${icon('search', 13)} Symptômes / signes observés</div><p>${escapeHtml(f.symptomes)}</p></div>` : ''}
              ${f.cause_probable ? `<div class="fiche-block"><div class="fiche-block-label">${icon('alertTriangle', 13)} Cause probable</div><p>${escapeHtml(f.cause_probable)}</p></div>` : ''}
              ${
                f.procedure_intervention
                  ? `<div class="fiche-block"><div class="fiche-block-label">${icon('clipboard', 13)} Procédure d'intervention</div>${renderProcedureSteps(f.procedure_intervention)}</div>`
                  : ''
              }
              ${f.securite ? `<div class="fiche-safety">${icon('alertTriangle', 15)} <div><strong>Sécurité / précautions</strong><p>${escapeHtml(f.securite)}</p></div></div>` : ''}
              ${
                f.outillage || f.pieces_rechange
                  ? `<div class="fiche-block-row">
                      ${f.outillage ? `<div class="fiche-block"><div class="fiche-block-label">${icon('wrench', 13)} Outillage</div><p>${escapeHtml(f.outillage)}</p></div>` : ''}
                      ${f.pieces_rechange ? `<div class="fiche-block"><div class="fiche-block-label">${icon('gauge', 13)} Pièces de rechange</div><p>${escapeHtml(f.pieces_rechange)}</p></div>` : ''}
                    </div>`
                  : ''
              }
              ${f.solution ? `<div class="fiche-block"><div class="fiche-block-label">${icon('check', 13)} Solution / résumé</div><p>${escapeHtml(f.solution)}</p></div>` : ''}
              ${
                (f.photos || []).length
                  ? `<div class="photo-row">${f.photos.map((p) => `<div class="photo-thumb"><img src="${p.url}"></div>`).join('')}</div>`
                  : ''
              }
              <div class="item-actions">
                ${isOwned(f) ? `<button class="btn-ghost" data-action="edit-fiche" data-id="${f.id}">Modifier</button>` : `<span class="hint">Créée par ${escapeHtml(f.tech || 'un autre technicien')} — seul l'auteur peut la modifier</span>`}
                ${!f.is_reference && isOwned(f) ? `<button class="btn-ghost" data-action="delete-fiche" data-id="${f.id}">Supprimer</button>` : ''}
              </div>
            </div>`
          : ''
      }
    </div>`;
}

function renderFicheCatalogGrid() {
  const present = FICHE_CATEGORIES.filter((cat) => state.fiches.some((f) => classifyFiche(f) === cat.key));
  const allTile = `
    <div class="fiche-cat-tile fiche-cat-all" data-action="open-fiche-category" data-category="toutes">
      <div class="fc-icon">${icon('search', 26)}</div>
      <div class="fc-label">Toutes les fiches</div>
      <div class="fc-count">${state.fiches.length} fiche${state.fiches.length > 1 ? 's' : ''}</div>
    </div>`;
  const catTiles = present
    .map((cat) => {
      const count = state.fiches.filter((f) => classifyFiche(f) === cat.key).length;
      return `
    <div class="fiche-cat-tile" style="--cat-color:var(${cat.colorVar});" data-action="open-fiche-category" data-category="${cat.key}">
      <div class="fc-icon">${icon(cat.icon, 26)}</div>
      <div class="fc-label">${escapeHtml(cat.label)}</div>
      <div class="fc-count">${count} fiche${count > 1 ? 's' : ''}</div>
    </div>`;
    })
    .join('');
  return `${allTile}<div class="fiche-cat-grid">${catTiles}</div>`;
}

export function renderFiches(searchTerm = '') {
  const list = document.getElementById('fichesList');
  const needle = searchTerm.trim().toLowerCase();

  if (!needle && !ficheCatalogView) {
    // Niveau 1 : grille du catalogue, sans lire le contenu d'aucune fiche.
    list.innerHTML = renderFicheCatalogGrid();
    return;
  }

  const filtered = state.fiches.filter((f) => {
    if (!needle && ficheCatalogView && ficheCatalogView !== 'toutes' && classifyFiche(f) !== ficheCatalogView) return false;
    if (!needle) return true;
    return (
      f.title.toLowerCase().includes(needle) ||
      (f.cause_probable || '').toLowerCase().includes(needle) ||
      (f.solution || '').toLowerCase().includes(needle)
    );
  });

  const backBar = `<button class="site-back" data-action="back-to-fiche-catalog">${icon('arrowLeft', 14)} Retour au catalogue</button>`;

  if (filtered.length === 0) {
    list.innerHTML = backBar + `<div class="empty-state">${icon('clipboard', 32)}<p>Aucune fiche</p></div>`;
    return;
  }

  // Une recherche/filtre qui ne laisse qu'une poignée de résultats : autant
  // les montrer dépliés directement plutôt que d'imposer un tap de plus.
  const autoExpand = filtered.length <= 3;
  list.innerHTML = backBar + filtered.map((f) => renderFicheTile(f, autoExpand)).join('');
}

// ===== CONFLITS DE FICHES (édition simultanée par deux techniciens) =====
// Champs texte comparés un par un lors d'une fusion. Les photos sont
// gérées à part (fusionnées automatiquement, pas de choix à faire — voir
// resolveFicheConflictMerge dans app.js).
export const FICHE_CONFLICT_FIELDS = [
  { field: 'title', label: 'Titre' },
  { field: 'urgence', label: 'Urgence' },
  { field: 'symptomes', label: 'Symptômes' },
  { field: 'cause_probable', label: 'Cause probable' },
  { field: 'procedure_intervention', label: "Procédure d'intervention" },
  { field: 'securite', label: 'Sécurité' },
  { field: 'outillage', label: 'Outillage' },
  { field: 'pieces_rechange', label: 'Pièces de rechange' },
  { field: 'solution', label: 'Solution' },
  { field: 'notes', label: 'Notes' },
];

let openConflictId = null;

export function openFicheConflict(id) {
  openConflictId = id;
  renderFicheConflicts();
}

export function closeFicheConflict() {
  openConflictId = null;
  renderFicheConflicts();
}

export function getOpenFicheConflict() {
  return state.ficheConflicts.find((c) => c.id === openConflictId) || null;
}

export function renderFicheConflicts() {
  const el = document.getElementById('ficheConflicts');
  if (!el) return;
  const conflicts = state.ficheConflicts;
  const badge = document.getElementById('fichesTabBadge');
  if (badge) badge.hidden = conflicts.length === 0;
  if (conflicts.length === 0) {
    el.innerHTML = '';
    return;
  }

  const open = conflicts.find((c) => c.id === openConflictId);
  if (open) {
    el.innerHTML = renderFicheConflictForm(open);
    return;
  }

  el.innerHTML = `
    <div class="card" style="border-left:4px solid var(--danger);">
      <div class="card-header">${icon('alertTriangle', 14)} ${conflicts.length} conflit${conflicts.length > 1 ? 's' : ''} de fiche à résoudre</div>
      <div class="card-body">
        ${conflicts
          .map(
            (c) => `
          <div class="item">
            <div class="item-title">${escapeHtml(c.serverFiche.title)}</div>
            <div class="item-meta">Modifiée par ${escapeHtml(c.serverFiche.tech || 'un collègue')} pendant que tu la modifiais</div>
            <div class="item-actions"><button class="btn-secondary" data-action="open-fiche-conflict" data-id="${c.id}">Comparer et fusionner</button></div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;
}

function conflictFieldChoice(conflictId, field, label, localVal, serverVal, theirName) {
  const local = (localVal || '').trim();
  const server = (serverVal || '').trim();
  if (local === server) return ''; // rien à choisir, les deux versions sont identiques sur ce champ
  return `
    <div class="conflict-field">
      <div class="conflict-field-label">${escapeHtml(label)}</div>
      <label class="conflict-choice">
        <input type="radio" name="conflict-${conflictId}-${field}" value="local" checked>
        <div class="conflict-value"><span class="conflict-tag mine">Ta version</span>${local ? escapeHtml(local) : '<em>(vide)</em>'}</div>
      </label>
      <label class="conflict-choice">
        <input type="radio" name="conflict-${conflictId}-${field}" value="server">
        <div class="conflict-value"><span class="conflict-tag theirs">${escapeHtml(theirName)}</span>${server ? escapeHtml(server) : '<em>(vide)</em>'}</div>
      </label>
    </div>`;
}

function renderFicheConflictForm(conflict) {
  const { id, localFiche, serverFiche } = conflict;
  const theirName = serverFiche.tech || 'Version du collègue';
  const fieldsHtml = FICHE_CONFLICT_FIELDS.map((f) => conflictFieldChoice(id, f.field, f.label, localFiche[f.field], serverFiche[f.field], theirName)).join('');
  const hasFieldDiffs = fieldsHtml.trim().length > 0;

  const localPhotos = localFiche.photos || [];
  const serverPhotos = serverFiche.photos || [];
  const newLocalPhotos = localPhotos.filter((p) => !serverPhotos.some((sp) => sp.id === p.id));

  return `
    <div class="card" style="border-left:4px solid var(--danger);">
      <div class="card-header">${icon('alertTriangle', 14)} Conflit — ${escapeHtml(serverFiche.title)}</div>
      <div class="card-body">
        <p class="hint">${escapeHtml(serverFiche.tech || 'Un collègue')} a modifié cette fiche pendant que tu la modifiais. Choisis quoi garder pour chaque champ différent, puis valide.</p>
        ${hasFieldDiffs ? fieldsHtml : `<p class="hint"><em>Aucun champ texte en conflit — seules les photos diffèrent peut-être.</em></p>`}
        ${
          newLocalPhotos.length > 0
            ? `<div class="conflict-field"><div class="conflict-field-label">Photos</div><p class="hint">${newLocalPhotos.length} photo(s) que tu as ajoutée(s) seront conservées en plus de celles de ${escapeHtml(serverFiche.tech || 'ton collègue')} — rien n'est perdu.</p></div>`
            : ''
        }
        <div class="btn-row">
          <button class="btn" data-action="confirm-fiche-conflict" data-id="${id}">Valider la fusion</button>
          <button class="btn-secondary" data-action="close-fiche-conflict">Retour à la liste</button>
        </div>
      </div>
    </div>`;
}

// ===== ACTIONS =====
const SEVERITY_ORDER = { danger: 0, warning: 1, none: 2 };
let expandedActionId = null;

export function toggleActionDetail(id) {
  expandedActionId = expandedActionId === id ? null : id;
  renderActions();
}

// Ouvre directement le détail d'une action donnée (au lieu de le basculer) —
// utilisé quand on saute vers une action depuis ailleurs (ex. détail d'une
// tuile de stat du Bilan), où l'on veut toujours l'afficher, pas l'inverser.
export function expandAction(id) {
  expandedActionId = id;
  renderActions();
}

// Même code visuel que renderBilanStatusChart() (donut + légende) : l'onglet
// Actions n'avait jusqu'ici qu'une liste brute, sans vue d'ensemble — étend
// le traitement visuel du Bilan à un autre onglet qui en manquait, comme
// demandé.
export function renderActionsSummary() {
  const el = document.getElementById('actionsSummary');
  if (!el) return;

  const total = state.actions.length;
  if (total === 0) {
    el.innerHTML = '<div class="trend-empty">Aucune action pour l\'instant</div>';
    return;
  }

  const open = state.actions.filter((a) => !a.done);
  const counts = {
    danger: open.filter((a) => a.severity === 'danger').length,
    warning: open.filter((a) => a.severity === 'warning').length,
    none: open.filter((a) => a.severity === 'none').length,
    done: state.actions.filter((a) => a.done).length,
  };

  const segments = [
    { label: 'Urgentes', count: counts.danger, color: 'var(--danger)' },
    { label: 'À surveiller', count: counts.warning, color: 'var(--warning)' },
    { label: 'Info', count: counts.none, color: 'var(--text-muted)' },
    { label: 'Traitées', count: counts.done, color: 'var(--success)' },
  ].filter((s) => s.count > 0);

  const size = 140, radius = 52, center = size / 2, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = segments
    .map((s) => {
      const dash = (s.count / total) * circumference;
      const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${center} ${center})"></circle>`;
      offset += dash;
      return circle;
    })
    .join('');
  const donePct = Math.round((counts.done / total) * 100);

  const legend = segments
    .map((s) => `<div class="donut-legend-row"><span class="donut-legend-dot" style="background:${s.color};"></span>${escapeHtml(s.label)} <strong>${s.count}</strong> <span class="hint">(${Math.round((s.count / total) * 100)}%)</span></div>`)
    .join('');

  el.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <text x="${center}" y="${center - 2}" text-anchor="middle" class="donut-center-value">${donePct}%</text>
        <text x="${center}" y="${center + 15}" text-anchor="middle" class="donut-center-label">Traitées</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

export function renderActions() {
  renderActionsSummary();
  const list = document.getElementById('actionsList');
  if (state.actions.length === 0) {
    list.innerHTML = `<div class="empty-state">${icon('check', 32)}<p>Aucune action</p></div>`;
    return;
  }
  const sorted = state.actions.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;
    return (b.ts || 0) - (a.ts || 0);
  });

  list.innerHTML = sorted
    .map((a) => {
      const expanded = expandedActionId === a.id;
      const substation = state.substations.find((s) => s.id === a.substation_id);
      return `
    <div class="item" data-action="toggle-action-detail" data-id="${a.id}" style="cursor:pointer;">
      <div class="item-row">
        <input type="checkbox" ${a.done ? 'checked' : ''} data-action="toggle-action" data-id="${a.id}">
        <div style="flex:1;">
          <div style="${a.done ? 'text-decoration:line-through;opacity:.5;' : ''}">
            ${a.severity && a.severity !== 'none' ? `<span class="badge ${a.severity === 'danger' ? 'immediat' : 'a_planifier'}">${a.severity === 'danger' ? 'Urgent' : 'À surveiller'}</span> ` : ''}
            ${escapeHtml(a.text)}
          </div>
          <div class="item-meta">${escapeHtml(a.date || '')}${a.tech ? ` · ${escapeHtml(a.tech)}` : ''}</div>
          ${
            expanded
              ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
                  ${
                    a.substation_id
                      ? `<div class="item-meta">${substation ? `Site : ${escapeHtml(substation.name)}` : 'Site : introuvable (site peut-être supprimé)'}</div>`
                      : `<div class="item-meta">Aucun site associé à cette action</div>`
                  }
                  <div class="item-meta" style="margin-top:2px;">${a.source === 'ronde' ? 'Créée automatiquement depuis une anomalie de ronde' : 'Ajoutée manuellement'}</div>
                  ${a.photo ? `<img src="${a.photo}" style="max-width:100%;border-radius:8px;margin-top:8px;display:block;">` : ''}
                  ${substation ? `<button class="btn-secondary" data-action="goto-action-site" data-site-id="${substation.id}" style="width:100%;margin-top:10px;">Voir la fiche du site</button>` : ''}
                </div>`
              : a.photo
                ? `<div class="photo-row"><div class="photo-thumb"><img src="${a.photo}"></div></div>`
                : ''
          }
        </div>
        ${isOwned(a) ? `<button class="btn-ghost" data-action="delete-action" data-id="${a.id}">✕</button>` : ''}
      </div>
    </div>`;
    })
    .join('');
}

// ===== MES : identification du poste =====
export function renderMesCasPosteSelect() {
  const select = document.getElementById('mesCasPoste');
  select.innerHTML =
    '<option value="">Choisir...</option>' +
    CAS_POSTE_TYPES.map((c) => `<option value="${c.cas}" ${state.mesPoste.cas_poste == c.cas ? 'selected' : ''}>Cas ${c.cas} — ${escapeHtml(c.code)} : ${escapeHtml(c.designation)}</option>`).join('');
}

const TYPE_COMPTEUR_LABEL = { kamstrup: 'Kamstrup', itron: 'Itron' };

export function renderMesEchangeurs() {
  const list = document.getElementById('mesEchangeursList');
  list.innerHTML = state.mesPoste.echangeurs
    .map(
      (e, i) => `
    <div class="card echangeur-card">
      <div class="card-header">Échangeur ${i + 1}</div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label>Type de boucle</label>
            <select data-action="set-echangeur" data-field="type_boucle" data-index="${i}">
              <option value="chaude" ${e.type_boucle === 'chaude' ? 'selected' : ''}>🔥 Eau chaude</option>
              <option value="glacee" ${e.type_boucle === 'glacee' ? 'selected' : ''}>❄️ Eau glacée</option>
            </select>
          </div>
          <div class="form-group">
            <label>N° contrat</label>
            <input type="text" data-action="set-echangeur" data-field="n_contrat" data-index="${i}" value="${escapeHtml(e.n_contrat)}" placeholder="ex. 4C012750">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>N° installation</label>
            <input type="text" data-action="set-echangeur" data-field="n_installation" data-index="${i}" value="${escapeHtml(e.n_installation)}">
          </div>
          <div class="form-group">
            <label>N° client</label>
            <input type="text" data-action="set-echangeur" data-field="n_client" data-index="${i}" value="${escapeHtml(e.n_client)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Débit nominal (m³/h)</label>
            <input type="number" step="0.1" data-action="set-echangeur" data-field="debit_nominal" data-index="${i}" value="${escapeHtml(e.debit_nominal)}">
          </div>
          <div class="form-group">
            <label>Puissance nominale (kW)</label>
            <input type="number" step="0.1" data-action="set-echangeur" data-field="puissance_nominale" data-index="${i}" value="${escapeHtml(e.puissance_nominale)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>T° aller nominale (°C)</label>
            <input type="number" step="0.1" data-action="set-echangeur" data-field="t_aller_nominale" data-index="${i}" value="${escapeHtml(e.t_aller_nominale)}">
          </div>
          <div class="form-group">
            <label>T° retour nominale (°C)</label>
            <input type="number" step="0.1" data-action="set-echangeur" data-field="t_retour_nominale" data-index="${i}" value="${escapeHtml(e.t_retour_nominale)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Adresse compteur (Modbus)</label>
            <input type="text" data-action="set-echangeur" data-field="adresse_compteur" data-index="${i}" value="${escapeHtml(e.adresse_compteur)}">
          </div>
          <div class="form-group">
            <label>Type compteur</label>
            <select data-action="set-echangeur" data-field="type_compteur" data-index="${i}">
              <option value="kamstrup" ${e.type_compteur === 'kamstrup' ? 'selected' : ''}>${TYPE_COMPTEUR_LABEL.kamstrup}</option>
              <option value="itron" ${e.type_compteur === 'itron' ? 'selected' : ''}>${TYPE_COMPTEUR_LABEL.itron}</option>
            </select>
          </div>
        </div>
      </div>
    </div>`
    )
    .join('');
}

export function renderMesNominalRecap() {
  const el = document.getElementById('mesNominalRecap');
  if (!el) return;
  const multi = state.mesPoste.echangeurs.length > 1;
  const rows = state.mesPoste.echangeurs.flatMap((e, i) => {
    const prefix = multi ? `Éch. ${i + 1} — ` : '';
    const fields = [
      ['debit_nominal', 'Débit nominal', 'm³/h'],
      ['puissance_nominale', 'Puissance nominale', 'kW'],
      ['t_aller_nominale', 'T° aller nominale', '°C'],
      ['t_retour_nominale', 'T° retour nominale', '°C'],
    ];
    return fields
      .filter(([field]) => e[field] !== '' && e[field] !== null && e[field] !== undefined)
      .map(([field, label, unit]) => `<div class="row"><span>${prefix}${label}</span><span class="val">${escapeHtml(e[field])} ${unit}</span></div>`);
  });
  if (!rows.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="card"><div class="card-header">${icon('gauge', 12)} Valeurs nominales de référence</div><div class="card-body nominal-recap">${rows.join('')}</div></div>`;
}

// Compare la valeur mesurée d'un point MES au paramètre nominal correspondant
// de l'échangeur (uniquement quand le poste n'a qu'un seul échangeur — au-delà
// l'affectation mesure/échangeur est ambiguë sur la checklist actuelle).
const POINT_NOMINAL_MAP = {
  'p6-5': { field: 'puissance_nominale', unit: 'kW' },
  'p4-5': { field: 'debit_nominal', unit: 'm³/h' },
};

function computeDeviationHint(index) {
  const point = state.mesChecks[index];
  const map = point && POINT_NOMINAL_MAP[point.id];
  if (!map || state.mesPoste.echangeurs.length !== 1) return '';
  const nominal = Number(state.mesPoste.echangeurs[0][map.field]);
  const mesure = Number(point.valeur);
  if (!nominal || point.valeur === '' || isNaN(mesure)) return '';
  const dev = ((mesure - nominal) / nominal) * 100;
  const cls = Math.abs(dev) > 10 ? 'warn' : 'ok';
  const sign = dev > 0 ? '+' : '';
  return `<span class="deviation-hint ${cls}">${sign}${dev.toFixed(1)}% vs nominal (${nominal} ${map.unit})</span>`;
}

export function updateDeviationHint(index) {
  const el = document.querySelector(`[data-hint-index="${index}"]`);
  if (el) el.innerHTML = computeDeviationHint(index);
}

export function refreshAllDeviationHints() {
  state.mesChecks.forEach((c, i) => {
    if (POINT_NOMINAL_MAP[c.id]) updateDeviationHint(i);
  });
}

export function renderMesProgress() {
  const total = state.mesChecks.length;
  const done = state.mesChecks.filter((c) => c.status).length;
  document.getElementById('mesProgressLabel').textContent = `${done}/${total} points`;
  document.getElementById('mesProgressFill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

export function renderMesChecks() {
  const list = document.getElementById('mesChecksList');
  const byCategory = {};
  state.mesChecks.forEach((c, i) => {
    if (!byCategory[c.category]) byCategory[c.category] = [];
    byCategory[c.category].push({ ...c, i });
  });

  list.innerHTML = Object.entries(byCategory)
    .map(
      ([category, points]) => `
    <div class="card" style="margin-bottom:10px;">
      <div class="card-header">${escapeHtml(category)}</div>
      <div class="card-body">
        ${points
          .map(
            (p) => `
          <div class="check-item">
            <div class="check-header">${escapeHtml(p.label)}</div>
            <div class="check-buttons">
              <button class="check-btn ok ${p.status === 'ok' ? 'sel' : ''}" data-action="set-mes-status" data-index="${p.i}" data-status="ok">OK</button>
              <button class="check-btn danger ${p.status === 'nok' ? 'sel' : ''}" data-action="set-mes-status" data-index="${p.i}" data-status="nok">NOK</button>
              <button class="check-btn na ${p.status === 'na' ? 'sel' : ''}" data-action="set-mes-status" data-index="${p.i}" data-status="na">N/A</button>
            </div>
            <input type="text" class="check-comment value-mono" style="margin-top:8px;" placeholder="Valeur relevée..." data-action="set-mes-value" data-index="${p.i}" value="${escapeHtml(p.valeur)}">
            <div data-hint-index="${p.i}">${computeDeviationHint(p.i)}</div>
            <textarea class="check-comment" placeholder="Commentaire..." data-action="set-mes-comment" data-index="${p.i}">${escapeHtml(p.commentaire)}</textarea>
          </div>`
          )
          .join('')}
      </div>
    </div>`
    )
    .join('');
  renderMesProgress();
}

export function renderMesHistory() {
  const list = document.getElementById('mesHistoryList');
  if (state.mesSessions.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML =
    '<div class="card"><div class="card-header">Sessions précédentes</div><div class="card-body">' +
    state.mesSessions
      .slice()
      .reverse()
      .map((m) => {
        const substation = state.substations.find((s) => s.id === m.substation_id);
        const nok = (m.checks || []).filter((c) => c.status === 'nok').length;
        return `<div class="item">
        <div class="item-title">${escapeHtml(substation ? substation.name : m.substation_id || 'Sous-station inconnue')}</div>
        <div class="item-meta">${escapeHtml(m.date || '')} · ${nok} point(s) NOK${m.tech ? ` · ${escapeHtml(m.tech)}` : ''}</div>
        ${isOwned(m) ? `<div class="item-actions"><button class="btn-ghost" data-action="delete-mes" data-id="${m.id}">Supprimer</button></div>` : ''}
      </div>`;
      })
      .join('') +
    '</div></div>';
}

// ===== HISTORIQUE (unifié) =====
export function formatDateFr(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDate;
}

export function buildHistoriqueItems() {
  const items = [];
  state.rondes.forEach((r) => {
    const substation = state.substations.find((s) => s.id === r.substation_id);
    const anomalies = (r.controls || []).filter((c) => c.status === 'warning' || c.status === 'danger').length;
    items.push({
      type: 'Ronde',
      ts: r.ts || 0,
      title: substation ? substation.name : r.substation_id,
      meta: `${formatDateFr(r.date)} ${r.heure || ''}${r.tech ? ` · ${r.tech}` : ''}`,
      body: r.observations,
      deleteAction: 'delete-ronde',
      id: r.id,
      statut: r.statut || 'operationnel',
      anomalies,
      substation_id: r.substation_id || null,
      owned: isOwned(r),
      searchable: `${substation ? substation.name : ''} ${r.tech || ''} ${r.observations || ''}`.toLowerCase(),
    });
  });
  state.fiches
    .filter((f) => !f.is_reference)
    .forEach((f) => {
      items.push({ type: 'Fiche', ts: f.ts || 0, title: f.title, meta: f.date || '', body: f.solution, deleteAction: 'delete-fiche', id: f.id, statut: null, anomalies: 0, substation_id: null, owned: true, searchable: `${f.title} ${f.cause_probable || ''}`.toLowerCase() });
    });
  state.actions.forEach((a) => {
    items.push({ type: 'Action', ts: a.ts || 0, title: a.text, meta: `${a.date || ''}${a.tech ? ` · ${a.tech}` : ''}`, body: a.done ? 'Traitée' : 'En attente', deleteAction: 'delete-action', id: a.id, statut: null, anomalies: a.severity !== 'none' ? 1 : 0, substation_id: a.substation_id || null, owned: isOwned(a), searchable: a.text.toLowerCase() });
  });
  state.mesSessions.forEach((m) => {
    const substation = state.substations.find((s) => s.id === m.substation_id);
    items.push({ type: 'MES', ts: m.ts || 0, title: substation ? substation.name : m.substation_id, meta: `${m.date || ''}${m.tech ? ` · ${m.tech}` : ''}`, body: m.notes, deleteAction: 'delete-mes', id: m.id, statut: null, anomalies: 0, substation_id: m.substation_id || null, owned: isOwned(m), searchable: `${substation ? substation.name : ''} ${m.notes || ''}`.toLowerCase() });
  });
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

// Rendu paginé : au-delà de quelques mois d'usage quotidien sur 140 sites,
// afficher tout l'historique d'un coup finit par ralentir l'appli (surtout
// sur téléphone ancien). On affiche par lots, avec un bouton "Afficher
// plus". Le lot courant se réinitialise seulement quand la recherche/le
// filtre changent réellement, pas à chaque re-render (ex: après suppression).
const HISTORIQUE_PAGE_SIZE = 60;
let historiqueVisibleCount = HISTORIQUE_PAGE_SIZE;
let historiqueLastQuery = null;

export function loadMoreHistorique() {
  historiqueVisibleCount += HISTORIQUE_PAGE_SIZE;
}

export function renderHistorique(filter = 'tous', searchTerm = '') {
  const content = document.getElementById('historiqueContent');
  const needle = searchTerm.trim().toLowerCase();
  const queryKey = `${filter}::${needle}`;
  if (queryKey !== historiqueLastQuery) {
    historiqueVisibleCount = HISTORIQUE_PAGE_SIZE;
    historiqueLastQuery = queryKey;
  }

  let items = buildHistoriqueItems();
  if (filter === 'anomalies') items = items.filter((it) => it.anomalies > 0);
  else if (filter !== 'tous') items = items.filter((it) => it.statut === filter);
  if (needle) items = items.filter((it) => it.searchable.includes(needle));

  if (items.length === 0) {
    content.innerHTML = `<div class="empty-state">${icon('search', 32)}<p>Aucune activité trouvée</p></div>`;
    return;
  }

  const statutBadge = { operationnel: '<span class="badge a_surveiller" style="background:var(--success-soft);color:var(--success);">OK</span>', reserve: '<span class="badge a_planifier">Réserve</span>', arret: '<span class="badge immediat">Arrêt</span>' };

  const visible = items.slice(0, historiqueVisibleCount);
  const remaining = items.length - visible.length;

  content.innerHTML =
    visible
      .map(
        (it) => `
    <div class="item">
      <div class="hist-type">${it.type} ${it.statut ? statutBadge[it.statut] || '' : ''}</div>
      <div class="item-title">${escapeHtml(it.title)}</div>
      <div class="item-meta">${escapeHtml(it.meta)}</div>
      ${it.body ? `<div class="item-body">${escapeHtml(it.body)}</div>` : ''}
      ${it.owned ? `<div class="item-actions"><button class="btn-ghost" data-action="${it.deleteAction}" data-id="${it.id}">Supprimer</button></div>` : ''}
    </div>`
      )
      .join('') +
    (remaining > 0
      ? `<button class="btn-secondary" style="width:100%; margin-top:10px;" data-action="load-more-historique">Afficher plus (${remaining} restant${remaining > 1 ? 's' : ''})</button>`
      : '');
}

export async function renderStorageUsage() {
  const el = document.getElementById('storageUsage');
  if (!el) return;
  if (!navigator.storage || !navigator.storage.estimate) {
    el.textContent = '';
    return;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const usageKo = Math.round((usage || 0) / 1024);
    const pct = quota ? Math.round(((usage || 0) / quota) * 1000) / 10 : null;
    el.textContent = `${usageKo} Ko utilisés${pct !== null ? ` (~${pct}% du quota navigateur)` : ''}`;
  } catch {
    el.textContent = '';
  }
}

// ===== BILAN AVANCÉ =====
function weekKey(date) {
  const d = new Date(date);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-${week}`;
}

export function renderBilanTrend() {
  const el = document.getElementById('bilanTrend');
  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(d);
  }
  const counts = weeks.map((d) => {
    const key = weekKey(d);
    return state.rondes.filter((r) => r.date && weekKey(r.date) === key).length;
  });

  if (counts.every((c) => c === 0)) {
    el.innerHTML = '<div class="trend-empty">Aucune ronde sur les 8 dernières semaines</div>';
    return;
  }

  const max = Math.max(...counts, 1);
  const w = 340, h = 110, pad = 20, barW = (w - pad * 2) / weeks.length - 6;
  const bars = counts
    .map((c, i) => {
      const x = pad + i * ((w - pad * 2) / weeks.length);
      const barH = (c / max) * (h - 30);
      const y = h - 20 - barH;
      const label = `${weeks[i].getDate().toString().padStart(2, '0')}/${(weeks[i].getMonth() + 1).toString().padStart(2, '0')}`;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="var(--accent)" rx="2"></rect><text x="${x + barW / 2}" y="${h - 6}" text-anchor="middle">${label}</text>${c > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${c}</text>` : ''}`;
    })
    .join('');

  el.innerHTML = `<svg class="trend-chart" viewBox="0 0 ${w} ${h}">${bars}</svg>`;
}

// Vue d'ensemble visuelle de l'état du parc (donut) plutôt qu'une simple
// liste de chiffres : en un coup d'œil, la proportion de contrôles OK vs
// dégradés vs défaillants sur les 30 derniers jours.
export function renderBilanStatusChart() {
  const el = document.getElementById('bilanStatusChart');
  const recentRondes = state.rondes.filter((r) => isWithinDays(r.date, 30));
  const counts = { ok: 0, warning: 0, danger: 0, na: 0 };
  recentRondes.forEach((r) => {
    (r.controls || []).forEach((c) => {
      if (c.status && counts[c.status] !== undefined) counts[c.status]++;
    });
  });
  const total = counts.ok + counts.warning + counts.danger + counts.na;

  if (total === 0) {
    el.innerHTML = '<div class="trend-empty">Aucun contrôle enregistré sur les 30 derniers jours</div>';
    return;
  }

  const segments = [
    { label: 'OK', count: counts.ok, color: 'var(--success)' },
    { label: 'Dégradé', count: counts.warning, color: 'var(--warning)' },
    { label: 'Défaillant', count: counts.danger, color: 'var(--danger)' },
    { label: 'N/A', count: counts.na, color: 'var(--text-muted)' },
  ].filter((s) => s.count > 0);

  const size = 140, radius = 52, center = size / 2, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = segments
    .map((s) => {
      const dash = (s.count / total) * circumference;
      const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${center} ${center})"></circle>`;
      offset += dash;
      return circle;
    })
    .join('');
  const okPct = Math.round((counts.ok / total) * 100);

  const legend = segments
    .map((s) => `<div class="donut-legend-row"><span class="donut-legend-dot" style="background:${s.color};"></span>${escapeHtml(s.label)} <strong>${s.count}</strong> <span class="hint">(${Math.round((s.count / total) * 100)}%)</span></div>`)
    .join('');

  el.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <text x="${center}" y="${center - 2}" text-anchor="middle" class="donut-center-value">${okPct}%</text>
        <text x="${center}" y="${center + 15}" text-anchor="middle" class="donut-center-label">OK</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

export function renderSitesNonVisites(thresholdDays) {
  const el = document.getElementById('sitesNonVisites');
  const lastVisit = {};
  state.rondes.forEach((r) => {
    if (!r.date) return;
    const t = new Date(r.date).getTime();
    if (!lastVisit[r.substation_id] || t > lastVisit[r.substation_id]) lastVisit[r.substation_id] = t;
  });

  const now = Date.now();
  const overdue = state.substations
    .map((s) => {
      const last = lastVisit[s.id];
      const days = last ? Math.floor((now - last) / 86400000) : null;
      return { s, days };
    })
    .filter((x) => x.days === null || x.days > thresholdDays)
    .sort((a, b) => (b.days ?? 99999) - (a.days ?? 99999));

  if (overdue.length === 0) {
    el.innerHTML = '<div class="alert success">✅ Tout est à jour</div>';
    return;
  }

  el.innerHTML = overdue
    .slice(0, 20)
    .map((x) => `<div class="alert warning">${escapeHtml(x.s.name)} — ${x.days === null ? 'jamais visitée' : `${x.days} j sans visite`}</div>`)
    .join('') + (overdue.length > 20 ? `<p class="hint">+ ${overdue.length - 20} autre(s)</p>` : '');
}

export function renderPointsRecurrents() {
  const el = document.getElementById('pointsRecurrents');
  const counts = {};
  state.rondes.forEach((r) => {
    (r.controls || []).forEach((c) => {
      if (c.status === 'warning' || c.status === 'danger') {
        counts[c.label] = (counts[c.label] || 0) + 1;
      }
    });
  });
  const recurrent = Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (recurrent.length === 0) {
    el.innerHTML = '<div class="alert success">✅ Aucun point récurrent</div>';
    return;
  }
  el.innerHTML = recurrent.map(([label, n]) => `<div class="alert warning"><strong>${escapeHtml(label)}</strong> — ${n} rondes</div>`).join('');
}

// ===== ALERTES PRÉDICTIVES (anomalies récurrentes par site) =====
// Un même point de contrôle relevé dégradé/défaillant à plusieurs reprises
// récemment sur un site est un signal qu'il vaut mieux traiter avant que ça
// ne devienne une panne franche, plutôt que d'attendre. Fenêtre glissante
// sur les dernières visites du site (pas une durée fixe) : un point qui
// redevient OK sort naturellement de la fenêtre et l'alerte disparaît.
const RECURRING_LOOKBACK = 5;
const RECURRING_THRESHOLD = 2;

export function computeSiteAlerts() {
  const bySite = {};
  state.rondes.forEach((r) => {
    if (!r.substation_id) return;
    (bySite[r.substation_id] ||= []).push(r);
  });

  const alerts = [];
  Object.entries(bySite).forEach(([substationId, rondes]) => {
    const recent = rondes
      .slice()
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, RECURRING_LOOKBACK);
    const byControl = {};
    recent.forEach((r) => {
      (r.controls || []).forEach((c) => {
        if (c.status !== 'warning' && c.status !== 'danger') return;
        const key = c.id || c.label;
        const entry = (byControl[key] ||= { label: c.label, occurrences: [], maxSeverity: 'warning' });
        entry.occurrences.push({ date: r.date, comment: c.comment });
        if (c.status === 'danger') entry.maxSeverity = 'danger';
      });
    });
    Object.values(byControl).forEach((entry) => {
      if (entry.occurrences.length >= RECURRING_THRESHOLD) {
        alerts.push({
          substation_id: substationId,
          label: entry.label,
          count: entry.occurrences.length,
          outOf: recent.length,
          severity: entry.maxSeverity,
          lastDate: entry.occurrences[0].date,
          lastComment: entry.occurrences[0].comment,
        });
      }
    });
  });

  alerts.sort((a, b) => (b.severity === 'danger' ? 1 : 0) - (a.severity === 'danger' ? 1 : 0) || b.count - a.count);
  return alerts;
}

export function getSiteAlertsFor(substationId) {
  return computeSiteAlerts().filter((a) => a.substation_id === substationId);
}

export function renderSitesASurveiller() {
  const el = document.getElementById('sitesASurveiller');
  if (!el) return;
  const alerts = computeSiteAlerts();
  if (alerts.length === 0) {
    el.innerHTML = '<div class="alert success">✅ Aucune anomalie récurrente détectée</div>';
    return;
  }
  el.innerHTML = alerts
    .map((a) => {
      const s = state.substations.find((x) => x.id === a.substation_id);
      return `<div class="alert ${a.severity === 'danger' ? 'danger' : 'warning'}" data-action="goto-site-alert" data-id="${a.substation_id}" style="cursor:pointer;">
        <strong>${escapeHtml(s ? s.name : a.substation_id)}</strong> — ${escapeHtml(a.label)}
        <br><span style="font-size:12px;opacity:.85;">${a.count}/${a.outOf} dernières visites${a.lastComment ? ` · "${escapeHtml(a.lastComment)}"` : ''}</span>
      </div>`;
    })
    .join('');
}

// Affiché dans l'onglet Ronde dès qu'une sous-station à risque est
// sélectionnée : avertir AVANT la visite plutôt que de laisser le
// technicien découvrir le problème en cours de ronde.
export function renderRondeSiteAlert(substation) {
  const el = document.getElementById('rondeSiteAlert');
  if (!el) return;
  if (!substation) {
    el.innerHTML = '';
    return;
  }
  const alerts = getSiteAlertsFor(substation.id);
  if (alerts.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = alerts
    .map(
      (a) => `<div class="alert ${a.severity === 'danger' ? 'danger' : 'warning'}" style="margin-bottom:6px;">
      ${icon('alertTriangle', 13)} <strong>${escapeHtml(a.label)}</strong> dégradé sur ${a.count}/${a.outOf} dernières visites de ce site — à vérifier en priorité.
    </div>`
    )
    .join('');
}

export function renderActionsRetardSite(thresholdDays = 7) {
  const el = document.getElementById('actionsRetardSite');
  const now = Date.now();
  const overdue = state.actions.filter((a) => !a.done && a.ts && (now - a.ts) / 86400000 > thresholdDays);

  if (overdue.length === 0) {
    el.innerHTML = '<div class="alert success">✅ Aucune action en retard</div>';
    return;
  }

  const bySite = {};
  overdue.forEach((a) => {
    const substation = state.substations.find((s) => s.id === a.substation_id);
    const name = substation ? substation.name : 'Sans sous-station';
    bySite[name] = (bySite[name] || 0) + 1;
  });

  el.innerHTML = Object.entries(bySite)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<div class="alert danger">${escapeHtml(name)} — ${n} action(s) en retard</div>`)
    .join('');
}

// ===== SITES (fiche technique par sous-station) =====
let selectedSiteId = null;
let editingSiteInfo = false;
let editingCommentId = null;

export function toggleSiteInfoEdit(on) {
  editingSiteInfo = on;
  if (on) editingCommentId = null;
  renderSiteDetail();
}

export function setEditingComment(id) {
  editingCommentId = id;
  if (id) editingSiteInfo = false;
  renderSiteDetail();
}

const SITE_STATUT_BADGE = {
  operationnel: '<span class="badge a_surveiller" style="background:var(--success-soft);color:var(--success);">Opérationnel</span>',
  reserve: '<span class="badge a_planifier">Réserve</span>',
  arret: '<span class="badge immediat">Arrêt</span>',
};

export function renderSiteList(searchTerm = '') {
  const listEl = document.getElementById('siteList');
  const needle = searchTerm.trim().toLowerCase();
  const sites = state.substations
    .filter((s) => !needle || s.name.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (sites.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${icon('building', 32)}<p>Aucune sous-station trouvée</p></div>`;
    return;
  }

  const lastVisit = {};
  state.rondes.forEach((r) => {
    if (!r.date) return;
    const t = new Date(r.date).getTime();
    if (!lastVisit[r.substation_id] || t > lastVisit[r.substation_id]) lastVisit[r.substation_id] = t;
  });
  const alertedSiteIds = new Set(computeSiteAlerts().map((a) => a.substation_id));

  listEl.innerHTML = sites
    .map((s) => {
      const last = lastVisit[s.id];
      const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
      const sub = days === null ? 'Jamais visitée' : `Vue il y a ${days} j`;
      return `<div class="site-list-item" data-action="select-site" data-id="${s.id}">
        <div><div class="name">${escapeHtml(s.name)}${alertedSiteIds.has(s.id) ? ` <span style="color:var(--warning);vertical-align:middle;" title="Anomalie récurrente détectée">${icon('alertTriangle', 13)}</span>` : ''}</div><div class="sub">${sub}</div></div>
        ${icon('chevronRight', 16)}
      </div>`;
    })
    .join('');
}

export function renderSiteDetail() {
  const el = document.getElementById('siteDetail');
  const listCard = document.getElementById('siteListCard');
  if (!selectedSiteId) {
    el.innerHTML = '';
    listCard.style.display = '';
    return;
  }
  const site = state.substations.find((s) => s.id === selectedSiteId);
  if (!site) {
    selectedSiteId = null;
    el.innerHTML = '';
    listCard.style.display = '';
    return;
  }
  listCard.style.display = 'none';

  const siteRondes = state.rondes.filter((r) => r.substation_id === site.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const siteActions = state.actions.filter((a) => a.substation_id === site.id);
  const siteMes = state.mesSessions.filter((m) => m.substation_id === site.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const lastRonde = siteRondes[0];
  const openActions = siteActions.filter((a) => !a.done).length;
  const lastMes = siteMes[0];

  let posteCard = `<div class="card"><div class="card-header">Dernière configuration MES connue</div><div class="card-body"><div class="alert neutral">Aucune session MES enregistrée pour ce site</div></div></div>`;
  if (lastMes && lastMes.poste) {
    const poste = lastMes.poste;
    const cas = CAS_POSTE_TYPES.find((c) => String(c.cas) === String(poste.cas_poste));
    const echRows = (poste.echangeurs || [])
      .map(
        (e, i) =>
          `<div class="row"><span>Éch. ${i + 1} (${e.type_boucle === 'glacee' ? 'eau glacée' : 'eau chaude'})</span><span class="val">${escapeHtml(e.puissance_nominale || '—')} kW · ${escapeHtml(e.debit_nominal || '—')} m³/h</span></div>`
      )
      .join('');
    posteCard = `<div class="card"><div class="card-header">Dernière configuration MES connue</div><div class="card-body nominal-recap">
      <div class="row"><span>Type de poste</span><span class="val">${cas ? `${cas.code} — ${escapeHtml(cas.designation)}` : '—'}</span></div>
      <div class="row"><span>Relevée le</span><span class="val">${escapeHtml(lastMes.date || '')}</span></div>
      ${echRows}
    </div></div>`;
  }

  const siteAlerts = getSiteAlertsFor(site.id);
  const alertsHtml = siteAlerts.length
    ? `<div class="card">
        <div class="card-header">${icon('alertTriangle', 13)} Anomalies récurrentes</div>
        <div class="card-body">
          ${siteAlerts
            .map(
              (a) => `<div class="alert ${a.severity === 'danger' ? 'danger' : 'warning'}" style="margin-bottom:6px;">
                <strong>${escapeHtml(a.label)}</strong> — ${a.count}/${a.outOf} dernières visites${a.lastComment ? `<br><span style="font-size:12px;opacity:.85;">"${escapeHtml(a.lastComment)}"</span>` : ''}
              </div>`
            )
            .join('')}
        </div>
      </div>`
    : '';

  const historiqueItems = buildHistoriqueItems().filter((it) => it.substation_id === site.id);
  const historiqueHtml = historiqueItems.length
    ? historiqueItems
        .slice(0, 30)
        .map(
          (it) => `<div class="item">
            <div class="hist-type">${it.type} ${it.statut ? SITE_STATUT_BADGE[it.statut] || '' : ''}</div>
            <div class="item-meta">${escapeHtml(it.meta)}</div>
            ${it.body ? `<div class="item-body">${escapeHtml(it.body)}</div>` : ''}
          </div>`
        )
        .join('')
    : `<div class="empty-state">${icon('search', 28)}<p>Aucune activité enregistrée sur ce site</p></div>`;

  el.innerHTML = `
    <button class="site-back" data-action="back-to-sites">${icon('arrowLeft', 14)} Retour à la liste</button>
    <div class="card">
      <div class="card-body">
        ${
          editingSiteInfo
            ? `<div class="form-group">
                 <label>Nom de la sous-station</label>
                 <input type="text" id="editSiteName" value="${escapeHtml(site.name)}">
               </div>
               <div class="form-group">
                 <label>Notes d'accès</label>
                 <textarea id="editSiteNotes" placeholder="Code portail, accès, etc.">${escapeHtml(site.notes_acces || '')}</textarea>
               </div>
               <div class="btn-row" style="margin-top:4px;">
                 <button class="btn" data-action="save-site-info">Enregistrer</button>
                 <button class="btn btn-secondary" data-action="cancel-site-info">Annuler</button>
               </div>`
            : `<div class="site-detail-header">
                 <h3>${escapeHtml(site.name)}</h3>
                 ${lastRonde ? SITE_STATUT_BADGE[lastRonde.statut || 'operationnel'] : ''}
                 <button class="icon-btn" data-action="edit-site-info" title="Modifier le nom / les notes d'accès" aria-label="Modifier">${icon('pencil', 15)}</button>
               </div>
               ${site.notes_acces ? `<div class="alert warning" style="margin-top:10px;">${escapeHtml(site.notes_acces)}</div>` : ''}
               ${site.needs_review ? '<span class="badge review">Position à vérifier</span>' : ''}`
        }
      </div>
    </div>
    ${alertsHtml}
    <div class="card">
      <div class="card-header">${icon('image', 12)} Photos du site</div>
      <div class="card-body">
        ${site.photos === undefined ? `<p class="hint" style="margin:0 0 8px;">Chargement des photos...</p>` : ''}
        <div class="photo-row">
          ${(site.photos || [])
            .map(
              (p) => `<div class="photo-thumb"><img src="${p.url}"><button class="remove-photo" data-action="remove-site-photo" data-photo-id="${p.id}">${icon('xCircle', 11)}</button></div>`
            )
            .join('')}
          <label class="photo-btn">${icon('camera', 14)} Ajouter<input type="file" accept="image/*" data-action="add-site-photo"></label>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">${icon('clipboard', 12)} Commentaires</div>
      <div class="card-body">
        ${site.comments === undefined ? `<p class="hint" style="margin:0 0 8px;">Chargement des commentaires...</p>` : ''}
        ${
          (site.comments || []).length
            ? (site.comments || [])
                .slice()
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map((c) => {
                  const meta = `${escapeHtml(c.tech || 'Technicien')} · ${new Date(c.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${c.edited_at ? ' · modifié' : ''}`;
                  if (editingCommentId === c.id) {
                    return `<div class="item" style="margin-bottom:8px;">
                      <div class="item-meta">${meta}</div>
                      <div class="form-group" style="margin:6px 0 0;">
                        <textarea id="editCommentInput" data-comment-id="${c.id}">${escapeHtml(c.text)}</textarea>
                      </div>
                      <div class="btn-row" style="margin-top:6px;">
                        <button class="btn" data-action="save-site-comment" data-comment-id="${c.id}">Enregistrer</button>
                        <button class="btn btn-secondary" data-action="cancel-site-comment">Annuler</button>
                      </div>
                    </div>`;
                  }
                  return `<div class="item" style="margin-bottom:8px;">
                    <div class="item-meta">${meta}</div>
                    <div class="item-body" style="margin-top:2px;">${escapeHtml(c.text)}</div>
                    ${
                      isOwned(c)
                        ? `<button class="btn-ghost" data-action="edit-site-comment" data-comment-id="${c.id}" style="margin-top:2px;">Modifier</button>
                           <button class="btn-ghost" data-action="remove-site-comment" data-comment-id="${c.id}" style="margin-top:2px;">Supprimer</button>`
                        : ''
                    }
                  </div>`;
                })
                .join('')
            : `<p class="hint" style="margin:0 0 10px;">Aucun commentaire pour ce site.</p>`
        }
        <div class="form-group" style="margin:10px 0 0;">
          <textarea id="siteCommentInput" placeholder="Ajouter un commentaire (remarque générale, historique, point de vigilance...)"></textarea>
        </div>
        <button class="btn-secondary" data-action="add-site-comment" style="width:100%;">Ajouter le commentaire</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Activité</div>
      <div class="card-body stat-grid">
        <div class="stat-tile"><div class="value">${siteRondes.length}</div><div class="label">Rondes enregistrées</div></div>
        <div class="stat-tile"><div class="value">${openActions}</div><div class="label">Actions ouvertes</div></div>
      </div>
    </div>
    ${posteCard}
    <div class="card">
      <div class="card-header">Historique du site</div>
      <div class="card-body">${historiqueHtml}</div>
    </div>
  `;
}

export function selectSite(id) {
  selectedSiteId = id;
  editingSiteInfo = false;
  editingCommentId = null;
  renderSiteDetail();
}

export function backToSiteList() {
  selectedSiteId = null;
  editingSiteInfo = false;
  editingCommentId = null;
  renderSiteDetail();
}

export function getSelectedSite() {
  return state.substations.find((s) => s.id === selectedSiteId) || null;
}

// ===== EXPORTS PROFESSIONNELS (PDF ronde / rapport hebdomadaire) =====
// Gabarit dédié (pas une capture de l'écran mobile) : couleurs figées en dur
// (indépendantes du thème clair/sombre courant) pour un document imprimable
// cohérent quel que soit le thème actif au moment de l'export.
const REPORT_COLORS = {
  text: '#17171A', muted: '#6B6B72', accent: '#9F1247',
  success: '#1F9D55', successSoft: '#E7F7ED',
  warning: '#B7791F', warningSoft: '#FDF3E3',
  danger: '#C53030', dangerSoft: '#FCEAEA',
  neutralSoft: '#EEEEF0', border: '#E6E6E9', bgAlt: '#F7F7F9',
};

const STATUS_REPORT_LABEL = { ok: 'OK', warning: 'Dégradé', danger: 'Défaillant', na: 'N/A' };

function reportStatusBadge(status) {
  const c = REPORT_COLORS;
  const map = {
    ok: [c.success, c.successSoft], warning: [c.warning, c.warningSoft],
    danger: [c.danger, c.dangerSoft], na: [c.muted, c.neutralSoft],
  };
  const [fg, bg] = map[status] || [c.muted, c.neutralSoft];
  return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:9.5px;font-weight:700;background:${bg};color:${fg};">${STATUS_REPORT_LABEL[status] || '—'}</span>`;
}

function statutColors(statut) {
  const c = REPORT_COLORS;
  if (statut === 'arret') return [c.danger, c.dangerSoft];
  if (statut === 'reserve') return [c.warning, c.warningSoft];
  return [c.success, c.successSoft];
}

function reportHeader(title, subtitle) {
  const c = REPORT_COLORS;
  return `
    <div style="display:flex;align-items:center;gap:12px;border-bottom:3px solid ${c.accent};padding-bottom:12px;margin-bottom:18px;">
      <div style="width:42px;height:42px;border-radius:11px;background:${c.accent};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;flex:none;">ID</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:${c.text};">${title}</div>
        <div style="font-size:10px;color:${c.muted};">${subtitle}</div>
      </div>
    </div>`;
}

function reportFooter() {
  const c = REPORT_COLORS;
  return `<div style="margin-top:22px;padding-top:8px;border-top:1px solid ${c.border};font-size:8px;color:${c.muted};text-align:center;">
    Généré automatiquement par Ronde V6 — IDEX · ${new Date().toLocaleString('fr-FR')}
  </div>`;
}

function reportSectionTitle(label) {
  return `<div style="font-size:10.5px;font-weight:800;color:${REPORT_COLORS.accent};text-transform:uppercase;letter-spacing:.4px;margin:18px 0 8px;">${label}</div>`;
}

// substation/tech/date/heure/observations : valeurs de la ronde en cours de
// saisie (pas encore forcément enregistrées), passées par l'appelant plutôt
// que relues dans le DOM pour garder ce module découplé du formulaire.
export function buildRondeReportHtml({ substation, tech, date, heure, observations }) {
  const c = REPORT_COLORS;
  const statutMeta = RONDE_STATUTS.find((s) => s.id === state.rondeStatut) || RONDE_STATUTS[0];
  const [statutColor, statutBg] = statutColors(state.rondeStatut);

  const controlsRows = state.controls
    .map(
      (ctrl) => `
    <tr style="border-bottom:1px solid ${c.border};">
      <td style="padding:7px 8px;font-size:10px;color:${c.text};">${escapeHtml(ctrl.label)}</td>
      <td style="padding:7px 8px;">${reportStatusBadge(ctrl.status)}</td>
      <td style="padding:7px 8px;font-size:9.5px;color:${c.muted};">${escapeHtml(ctrl.comment || '—')}</td>
    </tr>`
    )
    .join('');

  const withPhotos = state.controls.filter((ctrl) => ctrl.photo || ctrl.photoApres);
  const photosHtml = withPhotos.length
    ? `${reportSectionTitle('Photos')}
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${withPhotos
          .map(
            (ctrl) => `
          ${ctrl.photo ? `<div style="width:100px;"><img src="${ctrl.photo}" style="width:100%;border-radius:6px;border:1px solid ${c.border};display:block;"><div style="font-size:7.5px;color:${c.muted};text-align:center;margin-top:2px;">${escapeHtml(ctrl.label)} — avant</div></div>` : ''}
          ${ctrl.photoApres ? `<div style="width:100px;"><img src="${ctrl.photoApres}" style="width:100%;border-radius:6px;border:1px solid ${c.border};display:block;"><div style="font-size:7.5px;color:${c.muted};text-align:center;margin-top:2px;">${escapeHtml(ctrl.label)} — après</div></div>` : ''}`
          )
          .join('')}
      </div>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;padding:6px;background:#fff;">
      ${reportHeader('Compte-rendu de ronde', "Ronde V6 — IDEX · Sous-stations d'échange de chauffage urbain")}
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tr><td style="padding:4px 10px 4px 0;font-size:9.5px;font-weight:700;color:${c.muted};width:120px;">Sous-station</td><td style="padding:4px 0;font-size:11px;font-weight:700;color:${c.text};">${escapeHtml(substation ? substation.name : '—')}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;font-size:9.5px;font-weight:700;color:${c.muted};">Date / heure</td><td style="padding:4px 0;font-size:10.5px;color:${c.text};">${formatDateFr(date)}${heure ? ' — ' + heure : ''}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;font-size:9.5px;font-weight:700;color:${c.muted};">Intervenant</td><td style="padding:4px 0;font-size:10.5px;color:${c.text};">${escapeHtml(tech || '—')}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;font-size:9.5px;font-weight:700;color:${c.muted};">Statut à l'issue</td><td style="padding:4px 0;"><span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;background:${statutBg};color:${statutColor};">${statutMeta.label}</span></td></tr>
      </table>

      ${reportSectionTitle('Contrôles réalisés')}
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:${c.accent};color:#fff;">
          <th style="text-align:left;padding:7px 8px;font-size:9.5px;">Point de contrôle</th>
          <th style="text-align:left;padding:7px 8px;font-size:9.5px;width:80px;">Statut</th>
          <th style="text-align:left;padding:7px 8px;font-size:9.5px;">Commentaire</th>
        </tr>
        ${controlsRows}
      </table>

      ${reportSectionTitle('Observations')}
      <div style="font-size:10px;background:${c.bgAlt};border:1px solid ${c.border};border-radius:8px;padding:10px 12px;min-height:20px;color:${c.text};white-space:pre-wrap;">${escapeHtml(observations) || '—'}</div>

      ${photosHtml}
      ${reportFooter()}
    </div>`;
}

export function buildWeeklyReportHtml() {
  const c = REPORT_COLORS;
  const now = Date.now();
  const rondesWeek = state.rondes
    .filter((r) => {
      if (!r.date) return false;
      const diff = (now - new Date(r.date).getTime()) / 86400000;
      return diff >= 0 && diff <= 7;
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const anomaliesCount = rondesWeek.reduce(
    (sum, r) => sum + (r.controls || []).filter((ct) => ct.status === 'warning' || ct.status === 'danger').length,
    0
  );
  const sitesVisited = new Set(rondesWeek.map((r) => r.substation_id)).size;
  const SEVERITY_ORDER_R = { danger: 0, warning: 1, none: 2 };
  const actionsPending = state.actions
    .filter((a) => !a.done)
    .sort((a, b) => (SEVERITY_ORDER_R[a.severity] ?? 2) - (SEVERITY_ORDER_R[b.severity] ?? 2));

  const statTile = (value, label) => `
    <div style="flex:1;background:${c.bgAlt};border:1px solid ${c.border};border-radius:8px;padding:12px 6px;text-align:center;">
      <div style="font-size:20px;font-weight:800;color:${c.accent};">${value}</div>
      <div style="font-size:8.5px;color:${c.muted};margin-top:2px;">${label}</div>
    </div>`;

  const rondesRows = rondesWeek
    .map((r) => {
      const s = state.substations.find((x) => x.id === r.substation_id);
      const anomalies = (r.controls || []).filter((ct) => ct.status === 'warning' || ct.status === 'danger').length;
      const statutMeta = RONDE_STATUTS.find((st) => st.id === (r.statut || 'operationnel')) || RONDE_STATUTS[0];
      const [statutColor, statutBg] = statutColors(r.statut);
      return `<tr style="border-bottom:1px solid ${c.border};">
        <td style="padding:6px 8px;font-size:9.5px;color:${c.muted};white-space:nowrap;">${formatDateFr(r.date)}</td>
        <td style="padding:6px 8px;font-size:10px;color:${c.text};">${escapeHtml(s ? s.name : r.substation_id)}</td>
        <td style="padding:6px 8px;font-size:9.5px;color:${c.muted};">${escapeHtml(r.tech || '—')}</td>
        <td style="padding:6px 8px;"><span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:8.5px;font-weight:700;background:${statutBg};color:${statutColor};">${statutMeta.label}</span></td>
        <td style="padding:6px 8px;font-size:9.5px;text-align:center;color:${anomalies ? c.danger : c.muted};font-weight:${anomalies ? '700' : '400'};">${anomalies || '—'}</td>
      </tr>`;
    })
    .join('');

  const SEVERITY_LABEL = { danger: 'Urgent', warning: 'À surveiller', none: 'Info' };
  const actionsRows = actionsPending
    .map((a) => {
      const sevColor = a.severity === 'danger' ? c.danger : a.severity === 'warning' ? c.warning : c.muted;
      const sevBg = a.severity === 'danger' ? c.dangerSoft : a.severity === 'warning' ? c.warningSoft : c.neutralSoft;
      return `<tr style="border-bottom:1px solid ${c.border};">
        <td style="padding:6px 8px;"><span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:8.5px;font-weight:700;background:${sevBg};color:${sevColor};">${SEVERITY_LABEL[a.severity] || a.severity}</span></td>
        <td style="padding:6px 8px;font-size:9.5px;color:${c.text};">${escapeHtml(a.text)}</td>
        <td style="padding:6px 8px;font-size:9px;color:${c.muted};white-space:nowrap;">${escapeHtml(a.tech || '—')}</td>
      </tr>`;
    })
    .join('');

  const periodeDebut = formatDateFr(new Date(now - 7 * 86400000).toISOString().slice(0, 10));
  const periodeFin = formatDateFr(new Date(now).toISOString().slice(0, 10));

  return `
    <div style="font-family:Arial,sans-serif;padding:6px;background:#fff;">
      ${reportHeader('Rapport hebdomadaire', `Ronde V6 — IDEX · Semaine du ${periodeDebut} au ${periodeFin}`)}

      <div style="display:flex;gap:10px;margin-bottom:6px;">
        ${statTile(rondesWeek.length, 'Rondes effectuées')}
        ${statTile(sitesVisited, 'Sites visités')}
        ${statTile(anomaliesCount, 'Anomalies relevées')}
        ${statTile(actionsPending.length, 'Actions en attente')}
      </div>

      ${reportSectionTitle('Rondes de la semaine')}
      ${
        rondesWeek.length
          ? `<table style="width:100%;border-collapse:collapse;">
        <tr style="background:${c.accent};color:#fff;">
          <th style="text-align:left;padding:7px 8px;font-size:9px;">Date</th>
          <th style="text-align:left;padding:7px 8px;font-size:9px;">Sous-station</th>
          <th style="text-align:left;padding:7px 8px;font-size:9px;">Intervenant</th>
          <th style="text-align:left;padding:7px 8px;font-size:9px;">Statut</th>
          <th style="text-align:center;padding:7px 8px;font-size:9px;">Anomalies</th>
        </tr>
        ${rondesRows}
      </table>`
          : `<div style="font-size:10px;color:${c.muted};">Aucune ronde sur les 7 derniers jours.</div>`
      }

      ${reportSectionTitle(`Actions en attente (${actionsPending.length})`)}
      ${
        actionsPending.length
          ? `<table style="width:100%;border-collapse:collapse;">
        <tr style="background:${c.accent};color:#fff;">
          <th style="text-align:left;padding:7px 8px;font-size:9px;width:100px;">Gravité</th>
          <th style="text-align:left;padding:7px 8px;font-size:9px;">Description</th>
          <th style="text-align:left;padding:7px 8px;font-size:9px;width:90px;">Intervenant</th>
        </tr>
        ${actionsRows}
      </table>`
          : `<div style="font-size:10px;color:${c.muted};">Aucune action en attente.</div>`
      }

      ${reportFooter()}
    </div>`;
}
