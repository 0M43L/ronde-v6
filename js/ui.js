import { state, URGENCE_LABEL, CAS_POSTE_TYPES, RONDE_STATUTS } from './state.js';

export function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
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
             <div class="photo-row">
               <label class="photo-btn">📷 Avant<input type="file" accept="image/*" data-action="set-photo" data-index="${i}"></label>
               ${ctrl.photo ? `<div class="photo-thumb"><img src="${ctrl.photo}"><button class="remove-photo" data-action="remove-photo" data-index="${i}">✕</button></div>` : ''}
               <label class="photo-btn">📷 Après<input type="file" accept="image/*" data-action="set-photo-apres" data-index="${i}"></label>
               ${ctrl.photoApres ? `<div class="photo-thumb"><img src="${ctrl.photoApres}"><button class="remove-photo" data-action="remove-photo-apres" data-index="${i}">✕</button></div>` : ''}
             </div>
             <button class="btn-secondary" style="width:100%; margin-top:8px; ${ctrl.actionCreated ? 'opacity:.5;' : ''}" data-action="create-action-inline" data-index="${i}" ${ctrl.actionCreated ? 'disabled' : ''}>
               ${ctrl.actionCreated ? '✓ Action corrective créée' : '+ Créer une action corrective pour ce point'}
             </button>`
          : ''
      }
    </div>`
    )
    .join('');
}

// ===== STATUT À L'ISSUE =====
export function renderRondeStatut() {
  const el = document.getElementById('rondeStatutChoices');
  el.innerHTML = RONDE_STATUTS.map(
    (s) => `<button class="statut-btn ${state.rondeStatut === s.id ? 'sel ' + s.id : ''}" data-action="set-statut" data-statut="${s.id}">
      ${s.id === 'operationnel' ? '✅' : s.id === 'reserve' ? '⚠️' : '🛑'} ${escapeHtml(s.label)}
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

export function renderBilanStats() {
  const el = document.getElementById('bilanStats');
  const rondesWeek = state.rondes.filter((r) => isWithinDays(r.date, 7));
  const rondesMonth = state.rondes.filter((r) => isWithinDays(r.date, 30));
  const sstWeek = new Set(rondesWeek.map((r) => r.substation_id)).size;
  const sstMonth = new Set(rondesMonth.map((r) => r.substation_id)).size;
  const openActions = state.actions.filter((a) => !a.done).length;
  const urgentActions = state.actions.filter((a) => !a.done && a.severity === 'danger').length;

  const tiles = [
    { value: sstWeek, label: 'Sous-stations vues cette semaine' },
    { value: rondesWeek.length, label: 'Rondes cette semaine' },
    { value: sstMonth, label: 'Sous-stations vues ce mois' },
    { value: rondesMonth.length, label: 'Rondes ce mois' },
    { value: openActions, label: 'Actions en attente' },
    { value: urgentActions, label: 'Actions urgentes' },
  ];

  el.innerHTML = tiles.map((t) => `<div class="stat-tile"><div class="value">${t.value}</div><div class="label">${t.label}</div></div>`).join('');
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
export function renderFiches(searchTerm = '') {
  const list = document.getElementById('fichesList');
  const needle = searchTerm.trim().toLowerCase();
  const filtered = state.fiches.filter((f) => {
    if (!needle) return true;
    return (
      f.title.toLowerCase().includes(needle) ||
      (f.cause_probable || '').toLowerCase().includes(needle) ||
      (f.solution || '').toLowerCase().includes(needle)
    );
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">▤</div><p>Aucune fiche</p></div>';
    return;
  }

  list.innerHTML = filtered
    .map(
      (f) => `
    <div class="fiche-card">
      <div class="fiche-title">${escapeHtml(f.title)}${f.is_reference ? '<span class="badge a_surveiller">Référence</span>' : ''}</div>
      <dl>
        ${f.cause_probable ? `<dt>Cause probable</dt><dd>${escapeHtml(f.cause_probable)}</dd>` : ''}
        ${f.solution ? `<dt>Solution</dt><dd>${escapeHtml(f.solution)}</dd>` : ''}
      </dl>
      ${!f.is_reference ? `<div class="item-actions"><button class="btn-ghost" data-action="delete-fiche" data-id="${f.id}">Supprimer</button></div>` : ''}
    </div>`
    )
    .join('');
}

// ===== ACTIONS =====
const SEVERITY_ORDER = { danger: 0, warning: 1, none: 2 };

export function renderActions() {
  const list = document.getElementById('actionsList');
  if (state.actions.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">✓</div><p>Aucune action</p></div>';
    return;
  }
  const sorted = state.actions.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;
    return (b.ts || 0) - (a.ts || 0);
  });

  list.innerHTML = sorted
    .map(
      (a) => `
    <div class="item">
      <div class="item-row">
        <input type="checkbox" ${a.done ? 'checked' : ''} data-action="toggle-action" data-id="${a.id}">
        <div style="flex:1;">
          <div style="${a.done ? 'text-decoration:line-through;opacity:.5;' : ''}">
            ${a.severity && a.severity !== 'none' ? `<span class="badge ${a.severity === 'danger' ? 'immediat' : 'a_planifier'}">${a.severity === 'danger' ? 'Urgent' : 'À surveiller'}</span> ` : ''}
            ${escapeHtml(a.text)}
          </div>
          <div class="item-meta">${escapeHtml(a.date || '')}</div>
          ${a.photo ? `<div class="photo-row"><div class="photo-thumb"><img src="${a.photo}"></div></div>` : ''}
        </div>
        <button class="btn-ghost" data-action="delete-action" data-id="${a.id}">✕</button>
      </div>
    </div>`
    )
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
            <input type="text" class="check-comment" style="margin-top:8px;" placeholder="Valeur relevée..." data-action="set-mes-value" data-index="${p.i}" value="${escapeHtml(p.valeur)}">
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
        <div class="item-meta">${escapeHtml(m.date || '')} · ${nok} point(s) NOK</div>
        <div class="item-actions"><button class="btn-ghost" data-action="delete-mes" data-id="${m.id}">Supprimer</button></div>
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
      meta: `${formatDateFr(r.date)} ${r.heure || ''} · ${r.tech || ''}`,
      body: r.observations,
      deleteAction: 'delete-ronde',
      id: r.id,
      statut: r.statut || 'operationnel',
      anomalies,
      searchable: `${substation ? substation.name : ''} ${r.tech || ''} ${r.observations || ''}`.toLowerCase(),
    });
  });
  state.fiches
    .filter((f) => !f.is_reference)
    .forEach((f) => {
      items.push({ type: 'Fiche', ts: f.ts || 0, title: f.title, meta: f.date || '', body: f.solution, deleteAction: 'delete-fiche', id: f.id, statut: null, anomalies: 0, searchable: `${f.title} ${f.cause_probable || ''}`.toLowerCase() });
    });
  state.actions.forEach((a) => {
    items.push({ type: 'Action', ts: a.ts || 0, title: a.text, meta: a.date || '', body: a.done ? 'Traitée' : 'En attente', deleteAction: 'delete-action', id: a.id, statut: null, anomalies: a.severity !== 'none' ? 1 : 0, searchable: a.text.toLowerCase() });
  });
  state.mesSessions.forEach((m) => {
    const substation = state.substations.find((s) => s.id === m.substation_id);
    items.push({ type: 'MES', ts: m.ts || 0, title: substation ? substation.name : m.substation_id, meta: m.date || '', body: m.notes, deleteAction: 'delete-mes', id: m.id, statut: null, anomalies: 0, searchable: `${substation ? substation.name : ''} ${m.notes || ''}`.toLowerCase() });
  });
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

export function renderHistorique(filter = 'tous', searchTerm = '') {
  const content = document.getElementById('historiqueContent');
  const needle = searchTerm.trim().toLowerCase();

  let items = buildHistoriqueItems();
  if (filter === 'anomalies') items = items.filter((it) => it.anomalies > 0);
  else if (filter !== 'tous') items = items.filter((it) => it.statut === filter);
  if (needle) items = items.filter((it) => it.searchable.includes(needle));

  if (items.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="icon">▤</div><p>Aucune activité trouvée</p></div>';
    return;
  }

  const statutBadge = { operationnel: '<span class="badge a_surveiller" style="background:var(--success-soft);color:var(--success);">OK</span>', reserve: '<span class="badge a_planifier">Réserve</span>', arret: '<span class="badge immediat">Arrêt</span>' };

  content.innerHTML = items
    .map(
      (it) => `
    <div class="item">
      <div class="hist-type">${it.type} ${it.statut ? statutBadge[it.statut] || '' : ''}</div>
      <div class="item-title">${escapeHtml(it.title)}</div>
      <div class="item-meta">${escapeHtml(it.meta)}</div>
      ${it.body ? `<div class="item-body">${escapeHtml(it.body)}</div>` : ''}
      <div class="item-actions"><button class="btn-ghost" data-action="${it.deleteAction}" data-id="${it.id}">Supprimer</button></div>
    </div>`
    )
    .join('');
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
