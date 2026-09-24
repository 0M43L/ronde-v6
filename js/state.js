export const CONTROLS_DEF = [
  { id: 'fuite', label: 'Absence de fuite (raccords, vannes, échangeur, purgeurs)' },
  { id: 'isolation', label: 'Calorifuge en bon état (pas de manchon arraché, déchiré ou manquant)' },
  { id: 'vannes', label: 'Vannes manœuvrables, sans blocage ni fuite au presse-étoupe' },
  { id: 'instrumentation', label: 'Instrumentation lisible et fonctionnelle (sondes, capteurs, afficheurs)' },
  { id: 'bruit', label: 'Absence de bruit ou vibration anormale (pompe, vannes, échangeur)' },
  { id: 'compteur', label: "Compteur d'énergie fonctionnel, affichage cohérent" },
  { id: 'plombs', label: 'Plombs de sécurité présents sur les intégrateurs (non arrachés)' },
  { id: 'proprete', label: "Propreté du local (sol, armoire, pas d'encombrement)" },
  { id: 'graissage', label: 'Graissage des vannes à jour (pas de grippage constaté)' },
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

// Les 8 cas de poste réels IDEX La Défense (procédure de chargement/paramétrage
// automates SST). Libellés extraits automatiquement du PDF — à vérifier avec
// Axel si un doute (deux lignes source portent le même libellé "1 échangeur
// froid (non Asstek)" avec des codes cas différents, probablement G1a=Asstek
// et G1=non Asstek malgré le texte extrait).
export const CAS_POSTE_TYPES = [
  { cas: 8, code: 'C1', designation: '1 échangeur chaud', exemple: '40801 (Micro850)' },
  { cas: 9, code: 'C2', designation: '2 échangeurs chauds', exemple: '40301 (Micro850)' },
  { cas: 10, code: 'C3', designation: '3 échangeurs chauds', exemple: '10301 (Micro850)' },
  { cas: 3, code: 'G1a', designation: '1 échangeur froid (non Asstek)', exemple: 'B1201 (Micro850)' },
  { cas: 11, code: 'G1aC1', designation: '1 échangeur froid Asstek + 1 échangeur chaud', exemple: 'A0201 (Micro850)' },
  { cas: 14, code: 'G1C1', designation: '1 échangeur froid + 1 échangeur chaud', exemple: '91201 (Micro870)' },
  { cas: 15, code: 'G1C2', designation: '1 échangeur froid + 2 échangeurs chauds', exemple: '21401 (Micro870E)' },
  { cas: 1, code: 'G1', designation: '1 échangeur froid (non Asstek)', exemple: 'C0201 (Micro870E)' },
];

export const RONDE_STATUTS = [
  { id: 'operationnel', label: 'Opérationnel' },
  { id: 'reserve', label: 'Opérationnel avec réserve' },
  { id: 'arret', label: 'Arrêt / intervention requise' },
];

export function emptyEchangeur() {
  return {
    type_boucle: 'chaude',
    n_contrat: '',
    n_installation: '',
    n_client: '',
    puissance_nominale: '',
    debit_nominal: '',
    t_aller_nominale: '',
    t_retour_nominale: '',
    adresse_compteur: '',
    type_compteur: 'kamstrup',
  };
}

export function emptyPoste() {
  return {
    representant_client: '',
    cas_poste: '',
    nb_echangeurs: 1,
    echangeurs: [emptyEchangeur()],
  };
}

export const state = {
  user: null,
  currentTab: 'ronde',
  substations: [],
  controls: CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '', photo: null, photoApres: null, actionCreated: false })),
  rondeStatut: 'operationnel',
  fiches: [],
  actions: [],
  mesSessions: [],
  mesChecks: MES_POINTS_DEF.map((p) => ({ ...p, status: null, valeur: '', commentaire: '' })),
  mesPoste: emptyPoste(),
  rondes: [],
  lastDiagnostic: null,
  pendingGeoSubstation: null,
  // Conflits d'édition de fiches en attente d'une fusion manuelle par le
  // technicien (voir js/app.js resolveFicheConflict et js/ui.js les
  // fonctions de rendu associées).
  ficheConflicts: [],
  // Ids en cours de suppression (toast "Annuler" affiché, quelques secondes
  // avant suppression réelle) : masqués de toutes les listes sans être
  // encore retirés de la base ni de la file de synchro — voir softDelete()
  // dans app.js et showUndoToast() dans ui.js.
  pendingDeleteIds: new Set(),
  // Clés `${entity_type}:${id}` des éléments encore dans la file de synchro
  // locale, recalculées à chaque changement de statut de synchro — permet
  // d'afficher un repère "pas encore synchronisé" sur l'élément précis
  // concerné plutôt qu'un simple compteur global.
  syncQueueKeys: new Set(),
};

export function resetControls() {
  state.controls = CONTROLS_DEF.map((c) => ({ ...c, status: null, comment: '', photo: null, photoApres: null, actionCreated: false }));
  state.rondeStatut = 'operationnel';
}

export function resetMesChecks() {
  state.mesChecks = MES_POINTS_DEF.map((p) => ({ ...p, status: null, valeur: '', commentaire: '' }));
  state.mesPoste = emptyPoste();
}
