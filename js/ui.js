import { state, URGENCE_LABEL } from './state.js';

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
               <label class="photo-btn">📷 Photo<input type="file" accept="image/*" data-action="set-photo" data-index="${i}"></label>
               ${ctrl.photo ? `<div class="photo-thumb"><img src="${ctrl.photo}"><button class="remove-photo" data-action="remove-photo" data-index="${i}">✕</button></div>` : ''}
             </div>`
          : ''
      }
    </div>`
    )
    .join('');
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

// ===== MES =====
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
export function renderHistorique() {
  const content = document.getElementById('historiqueContent');

  const items = [];
  state.rondes.forEach((r) => {
    const substation = state.substations.find((s) => s.id === r.substation_id);
    items.push({
      type: 'Ronde',
      ts: r.ts || 0,
      title: substation ? substation.name : r.substation_id,
      meta: `${r.date || ''} ${r.heure || ''} · ${r.tech || ''}`,
      body: r.observations,
      deleteAction: 'delete-ronde',
      id: r.id,
    });
  });
  state.fiches
    .filter((f) => !f.is_reference)
    .forEach((f) => {
      items.push({ type: 'Fiche', ts: f.ts || 0, title: f.title, meta: f.date || '', body: f.solution, deleteAction: 'delete-fiche', id: f.id });
    });
  state.actions.forEach((a) => {
    items.push({ type: 'Action', ts: a.ts || 0, title: a.text, meta: a.date || '', body: a.done ? 'Traitée' : 'En attente', deleteAction: 'delete-action', id: a.id });
  });
  state.mesSessions.forEach((m) => {
    const substation = state.substations.find((s) => s.id === m.substation_id);
    items.push({ type: 'MES', ts: m.ts || 0, title: substation ? substation.name : m.substation_id, meta: m.date || '', body: m.notes, deleteAction: 'delete-mes', id: m.id });
  });

  items.sort((a, b) => b.ts - a.ts);

  if (items.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="icon">▤</div><p>Aucune activité enregistrée</p></div>';
    return;
  }

  content.innerHTML = items
    .map(
      (it) => `
    <div class="item">
      <div class="hist-type">${it.type}</div>
      <div class="item-title">${escapeHtml(it.title)}</div>
      <div class="item-meta">${escapeHtml(it.meta)}</div>
      ${it.body ? `<div class="item-body">${escapeHtml(it.body)}</div>` : ''}
      <div class="item-actions"><button class="btn-ghost" data-action="${it.deleteAction}" data-id="${it.id}">Supprimer</button></div>
    </div>`
    )
    .join('');
}
