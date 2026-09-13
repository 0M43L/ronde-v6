import { state } from './state.js';

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
export function renderSubstationSelect() {
  const select = document.getElementById('rondeSubstation');
  const current = select.value;
  select.innerHTML = '<option value="">Choisir une sous-station...</option>' +
    state.substations
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}${s.needs_review ? ' ⚠' : ''}</option>`)
      .join('');
  if (current) select.value = current;
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
          ? `<textarea class="check-comment" placeholder="Commentaire..." data-action="set-comment" data-index="${i}">${escapeHtml(ctrl.comment)}</textarea>`
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

// ===== DIAGNOSTIC IA =====
const URGENCE_LABEL = { immediat: 'Immédiat', a_planifier: 'À planifier', a_surveiller: 'À surveiller' };

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

// ===== FICHES =====
export function renderFiches() {
  const list = document.getElementById('fichesList');
  if (state.fiches.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">▤</div><p>Aucune fiche</p></div>';
    return;
  }
  list.innerHTML = state.fiches
    .slice()
    .reverse()
    .map(
      (f) => `
    <div class="item">
      <div class="item-title">${escapeHtml(f.type)}</div>
      <div class="item-meta">${escapeHtml(f.date)}</div>
      <div class="item-body">${escapeHtml(f.description)}</div>
      <div class="item-actions"><button class="btn-ghost" data-action="delete-fiche" data-id="${f.id}">Supprimer</button></div>
    </div>`
    )
    .join('');
}

// ===== ACTIONS =====
export function renderActions() {
  const list = document.getElementById('actionsList');
  if (state.actions.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">✓</div><p>Aucune action</p></div>';
    return;
  }
  list.innerHTML = state.actions
    .slice()
    .reverse()
    .map(
      (a) => `
    <div class="item">
      <div class="item-row">
        <input type="checkbox" ${a.done ? 'checked' : ''} data-action="toggle-action" data-id="${a.id}">
        <div style="flex:1;">
          <div style="${a.done ? 'text-decoration:line-through;opacity:.5;' : ''}">${escapeHtml(a.text)}</div>
          <div class="item-meta">${escapeHtml(a.date)}</div>
        </div>
        <button class="btn-ghost" data-action="delete-action" data-id="${a.id}">✕</button>
      </div>
    </div>`
    )
    .join('');
}

// ===== HISTORIQUE =====
export function renderHistorique() {
  const content = document.getElementById('historiqueContent');
  if (state.rondes.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="icon">▤</div><p>Aucune ronde enregistrée</p></div>';
    return;
  }
  content.innerHTML = state.rondes
    .slice()
    .reverse()
    .map((r) => {
      const substation = state.substations.find((s) => s.id === r.substation_id);
      return `
    <div class="item">
      <div class="item-title">${escapeHtml(substation ? substation.name : r.substation_id)}</div>
      <div class="item-meta">${escapeHtml(r.date || '')} ${escapeHtml(r.heure || '')} · ${escapeHtml(r.tech || '')}</div>
      ${r.observations ? `<div class="item-body">${escapeHtml(r.observations)}</div>` : ''}
      <div class="item-actions"><button class="btn-ghost" data-action="delete-ronde" data-id="${r.id}">Supprimer</button></div>
    </div>`;
    })
    .join('');
}
