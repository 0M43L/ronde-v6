export const CONTROLS_DEF = [
  { id: 'fuite', label: 'Absence de fuite' },
  { id: 'isolation', label: 'État isolations / calorifuge' },
  { id: 'vannes', label: 'État vannes' },
  { id: 'instrumentation', label: 'État instrumentation' },
  { id: 'bruit', label: 'Bruit / vibrations anormaux' },
  { id: 'compteur', label: 'État compteur énergie' },
  { id: 'proprete', label: 'Propreté locale technique' },
  { id: 'graissage', label: 'Graissage vanne' },
];

// Liste provisoire — à remplacer par les 41 points réels transmis par le technicien.
export const MES_POINTS_DEF = [
  { id: 'mes-placeholder-1', category: 'À compléter', label: 'Point de vérification à définir (liste réelle en attente)' },
];

export const URGENCE_LABEL = { immediat: 'Immédiat', a_planifier: 'À planifier', a_surveiller: 'À surveiller' };

export const state = {
  user: null,
  currentTab: 'ronde',
  substations: [],
  controls: CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '', photo: null })),
  fiches: [],
  actions: [],
  mesSessions: [],
  mesChecks: MES_POINTS_DEF.map((p) => ({ ...p, status: null, valeur: '', commentaire: '' })),
  rondes: [],
  lastDiagnostic: null,
  pendingGeoSubstation: null,
};

export function resetControls() {
  state.controls = CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '', photo: null }));
}

export function resetMesChecks() {
  state.mesChecks = MES_POINTS_DEF.map((p) => ({ ...p, status: null, valeur: '', commentaire: '' }));
}
