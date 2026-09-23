import { getSyncQueue, clearSyncQueueItems } from './db.js';
import { pushSyncQueue } from './api.js';

let onStatusChange = () => {};
let onSyncErrors = () => {};
let onSyncProgress = () => {};

export function setSyncStatusListener(fn) {
  onStatusChange = fn;
}

// Appelé avec la liste des entrées de la file rejetées par le serveur (ex :
// donnée invalide). Ces entrées restent en file pour être revues plutôt que
// silencieusement perdues — voir syncNow().
export function setSyncErrorListener(fn) {
  onSyncErrors = fn;
}

// Appelé (processed, total) au fil de la synchro, pour afficher une
// progression pendant l'envoi plutôt que de laisser le badge figé sur "en
// attente" sans rien montrer tant que tout n'est pas fini — utile surtout
// quand la file contient des photos et que l'envoi prend du temps.
export function setSyncProgressListener(fn) {
  onSyncProgress = fn;
}

// Compte les échecs consécutifs de la requête de synchro ENTIÈRE (pas les
// rejets d'un élément précis, déjà gérés par onSyncErrors) : session expirée,
// serveur en erreur, ou "en ligne" au sens du navigateur mais requête qui ne
// passe pas vraiment (signal faible). Sans ce compteur, ce genre de panne
// reste indiscernable d'un simple "en attente, ça va synchroniser d'un
// instant à l'autre" — pile ce qui rendait la file de 9 éléments d'Axel
// incompréhensible : ni erreur ni signe que quelque chose n'allait pas.
let consecutiveFailures = 0;
let lastError = null;

export async function refreshSyncStatus() {
  const queue = await getSyncQueue();
  if (!navigator.onLine) {
    onStatusChange('offline', queue.length);
  } else if (queue.length > 0 && consecutiveFailures >= 2) {
    onStatusChange('error', queue.length, lastError);
  } else if (queue.length > 0) {
    onStatusChange('pending', queue.length);
  } else {
    onStatusChange('synced', 0);
  }
  return queue.length;
}

// Envoyée par petits lots plutôt qu'en un seul bloc : une file avec des
// photos (ronde, action, avant/après) peut représenter plusieurs Mo une
// fois toutes envoyées d'un coup, au risque de dépasser la taille de
// requête acceptée par le serveur — dans ce cas, TOUTE la file échouait,
// indéfiniment, sans aucun moyen de comprendre pourquoi ni de progresser.
//
// Un lot qui échoue au niveau HTTP (pas une erreur par élément renvoyée par
// le serveur, mais la requête entière qui ne passe pas) est ensuite séparé
// en deux et chaque moitié retentée séparément, jusqu'à isoler précisément
// le ou les éléments réellement en cause — au lieu de laisser tout un lot
// de 5 bloqué ensemble à cause d'un seul élément trop lourd dedans.
const SYNC_BATCH_SIZE = 5;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncBatch(batch, ctx) {
  try {
    const result = await pushSyncQueue(batch);
    // Le serveur traite chaque entrée individuellement et peut en rejeter
    // certaines (ex : donnée invalide) sans faire échouer toute la requête.
    // Ne retirer de la file que ce qui a réellement été accepté : sinon une
    // entrée rejetée disparaît de la file locale sans jamais avoir atteint
    // la base partagée, perdue silencieusement.
    const failedIds = new Set((result.errors || []).map((e) => e.id));
    const succeededIds = batch.map((q) => q.id).filter((id) => !failedIds.has(id));
    await clearSyncQueueItems(succeededIds);
    ctx.totalSynced += result.synced;
    ctx.allErrors.push(...(result.errors || []));
    ctx.processed += batch.length;
    onSyncProgress(ctx.processed, ctx.total);
  } catch (err) {
    if (batch.length === 1) {
      // Impossible de réduire davantage : CET élément précis est en cause
      // (trop lourd, ou tout autre souci propre à lui). Il reste en file
      // pour la prochaine tentative automatique, mais n'empêche plus rien
      // d'autre d'avancer.
      if (!ctx.fatalError) ctx.fatalError = err;
      ctx.processed += 1;
      onSyncProgress(ctx.processed, ctx.total);
      return;
    }
    const mid = Math.ceil(batch.length / 2);
    await syncBatch(batch.slice(0, mid), ctx);
    await syncBatch(batch.slice(mid), ctx);
  }
}

// syncNow() est déclenché de plein d'endroits différents (minuteur toutes les
// 5 min, retour en ligne, clic manuel sur le badge, après avoir archivé une
// ronde/session MES/ajouté une photo...) sans qu'aucun ne sache si un envoi
// est déjà en cours. Deux synchros qui se chevauchent peuvent chacune lire
// puis écrire l'état d'UNE MÊME sous-station (ex : galerie de photos) sur la
// base de sa propre lecture, la seconde écrasant le travail de la première
// sans le savoir — perte silencieuse d'une photo pourtant bien envoyée. Avec
// des photos (envoi lent, fenêtre de chevauchement large), c'est le scénario
// le plus probable. Un seul envoi actif à la fois : tout appel pendant qu'un
// autre tourne déjà réutilise SON résultat plutôt que d'en démarrer un 2e en
// parallèle.
let inFlightSync = null;

export function syncNow() {
  if (inFlightSync) return inFlightSync;
  inFlightSync = runSync().finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

async function runSync() {
  if (!navigator.onLine) {
    await refreshSyncStatus();
    return { synced: 0, skipped: true };
  }

  const queue = await getSyncQueue();
  if (queue.length === 0) {
    consecutiveFailures = 0;
    lastError = null;
    await refreshSyncStatus();
    return { synced: 0, skipped: false };
  }

  const ctx = { totalSynced: 0, allErrors: [], fatalError: null, processed: 0, total: queue.length };
  onSyncProgress(0, queue.length);

  for (const batch of chunk(queue, SYNC_BATCH_SIZE)) {
    await syncBatch(batch, ctx);
  }

  if (ctx.fatalError) {
    consecutiveFailures++;
    lastError = ctx.fatalError;
    await refreshSyncStatus();
    throw ctx.fatalError;
  }

  consecutiveFailures = 0;
  lastError = null;
  await refreshSyncStatus();
  if (ctx.allErrors.length > 0) {
    const failedIds = new Set(ctx.allErrors.map((e) => e.id));
    const failedItems = queue.filter((q) => failedIds.has(q.id));
    onSyncErrors(failedItems, ctx.allErrors);
  }
  return { synced: ctx.totalSynced, skipped: false, errors: ctx.allErrors };
}

window.addEventListener('online', () => { syncNow().catch(() => {}); });
window.addEventListener('offline', () => { refreshSyncStatus(); });
setInterval(() => { syncNow().catch(() => {}); }, 5 * 60 * 1000);
