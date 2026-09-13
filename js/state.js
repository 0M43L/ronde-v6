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

export const state = {
  user: null,
  currentTab: 'ronde',
  substations: [],
  controls: CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '' })),
  fiches: [],
  actions: [],
  mesRecords: [],
  rondes: [],
  lastDiagnostic: null,
};

export function resetControls() {
  state.controls = CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '' }));
}
