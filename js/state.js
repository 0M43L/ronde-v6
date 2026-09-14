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

// Les 41 points de mise en service IDEX, en 8 phases.
export const MES_POINTS_DEF = [
  // Phase 1 - Avant mise sous tension
  { id: 'p1-1', category: 'Phase 1 — Avant mise sous tension', label: "Contrôle visuel de l'installation hydraulique conforme au plan" },
  { id: 'p1-2', category: 'Phase 1 — Avant mise sous tension', label: 'Purge et remplissage circuits primaire / secondaire effectués' },
  { id: 'p1-3', category: 'Phase 1 — Avant mise sous tension', label: 'Serrage raccords, brides, presse-étoupes vérifié' },
  { id: 'p1-4', category: 'Phase 1 — Avant mise sous tension', label: 'Continuité de terre du coffret vérifiée' },
  { id: 'p1-5', category: 'Phase 1 — Avant mise sous tension', label: 'Absence de corps étrangers / propreté du tableau' },

  // Phase 2 - Électrique & armoire
  { id: 'p2-1', category: 'Phase 2 — Électrique & armoire', label: "Tension d'alimentation conforme au schéma (230V/400V)" },
  { id: 'p2-2', category: 'Phase 2 — Électrique & armoire', label: 'Disjoncteurs et protections calibrés selon schéma' },
  { id: 'p2-3', category: 'Phase 2 — Électrique & armoire', label: 'Tension 24VCC présente et stable' },
  { id: 'p2-4', category: 'Phase 2 — Électrique & armoire', label: 'Contact détection porte tableau fonctionnel' },
  { id: 'p2-5', category: 'Phase 2 — Électrique & armoire', label: 'Repérage câbles et étiquetage conformes au schéma' },

  // Phase 3 - Configuration automate Micro850/870
  { id: 'p3-1', category: 'Phase 3 — Configuration automate Micro850/870', label: 'Type de poste (CAS_Poste 1 à 15) configuré conforme à l\'installation' },
  { id: 'p3-2', category: 'Phase 3 — Configuration automate Micro850/870', label: "Paramètres SPECVAR importés (N° contrat / installation / client)" },
  { id: 'p3-3', category: 'Phase 3 — Configuration automate Micro850/870', label: 'Présence des sondes primaires déclarée conforme (TTAPRIME / TTRPRIME)' },
  { id: 'p3-4', category: 'Phase 3 — Configuration automate Micro850/870', label: 'Adresses Modbus compteur(s) et GTC configurées' },
  { id: 'p3-5', category: 'Phase 3 — Configuration automate Micro850/870', label: 'Échelles maxi capteurs (température / pression) configurées' },

  // Phase 4 - Instrumentation
  { id: 'p4-1', category: 'Phase 4 — Instrumentation', label: 'Sondes température aller/retour primaire — raccordement et mesure cohérente' },
  { id: 'p4-2', category: 'Phase 4 — Instrumentation', label: 'Sondes température aller/retour secondaire (abonné) — mesure cohérente' },
  { id: 'p4-3', category: 'Phase 4 — Instrumentation', label: 'Capteur(s) pression aller primaire — échelle / étalonnage vérifiés' },
  { id: 'p4-4', category: 'Phase 4 — Instrumentation', label: 'Capteur pression différentielle — échelle / étalonnage vérifiés (si présent)' },
  { id: 'p4-5', category: 'Phase 4 — Instrumentation', label: "Compteur d'énergie — cohérence débit / température affichés" },

  // Phase 5 - Vannes & actionneurs
  { id: 'p5-1', category: 'Phase 5 — Vannes & actionneurs', label: 'Vanne de détente (VD) — sens et course vérifiés' },
  { id: 'p5-2', category: 'Phase 5 — Vannes & actionneurs', label: 'Vanne(s) de régulation (VR) — sens, course, signal analogique vérifiés' },
  { id: 'p5-3', category: 'Phase 5 — Vannes & actionneurs', label: 'Vanne de sécurité (VS) — position normalement fermée vérifiée (eau chaude)' },
  { id: 'p5-4', category: 'Phase 5 — Vannes & actionneurs', label: 'Vanne bypass / fins de course — fonctionnement vérifié (eau glacée)' },
  { id: 'p5-5', category: 'Phase 5 — Vannes & actionneurs', label: "Vannes d'isolement secondaire — manœuvre vérifiée" },

  // Phase 6 - Régulation & essais en charge
  { id: 'p6-1', category: 'Phase 6 — Régulation & essais en charge', label: 'Démarrage automatique échangeur (ΔT primaire > seuil) fonctionnel' },
  { id: 'p6-2', category: 'Phase 6 — Régulation & essais en charge', label: 'Régulation PID stabilise la température de consigne' },
  { id: 'p6-3', category: 'Phase 6 — Régulation & essais en charge', label: 'Limitation puissance/débit active correctement à 110% du nominal' },
  { id: 'p6-4', category: 'Phase 6 — Régulation & essais en charge', label: "Consigne calculée cohérente (loi d'eau / coefficient K abonné)" },
  { id: 'p6-5', category: 'Phase 6 — Régulation & essais en charge', label: 'Puissance mesurée cohérente avec calcul théorique P = q × K × ΔT' },

  // Phase 7 - Compteurs & communication
  { id: 'p7-1', category: 'Phase 7 — Compteurs & communication', label: 'Communication JBUS/Modbus compteur opérationnelle' },
  { id: 'p7-2', category: 'Phase 7 — Compteurs & communication', label: 'Index initiaux du compteur relevés et consignés' },
  { id: 'p7-3', category: 'Phase 7 — Compteurs & communication', label: 'Communication GTC client opérationnelle (si applicable)' },
  { id: 'p7-4', category: 'Phase 7 — Compteurs & communication', label: 'Commandes marche/arrêt depuis GTC testées (si applicable)' },
  { id: 'p7-5', category: 'Phase 7 — Compteurs & communication', label: 'Communication automate - frontal - supervision opérationnelle' },
  { id: 'p7-6', category: 'Phase 7 — Compteurs & communication', label: 'Synchronisation horaire automate vérifiée' },

  // Phase 8 - Sécurités & défauts (tests déclenchement)
  { id: 'p8-1', category: 'Phase 8 — Sécurités & défauts', label: 'Test pressostat HP (eau glacée) — réarmement vérifié' },
  { id: 'p8-2', category: 'Phase 8 — Sécurités & défauts', label: 'Test thermostat haute température ambiante (si présent)' },
  { id: 'p8-3', category: 'Phase 8 — Sécurités & défauts', label: 'Simulation défaut sonde température — comportement de repli conforme' },
  { id: 'p8-4', category: 'Phase 8 — Sécurités & défauts', label: 'Simulation défaut compteur / communication — comportement conforme' },
  { id: 'p8-5', category: 'Phase 8 — Sécurités & défauts', label: 'Synthèse défaut / télé-alarme vers supervision testée' },
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
