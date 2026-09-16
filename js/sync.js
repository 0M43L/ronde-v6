import { getSyncQueue, clearSyncQueueItems } from './db.js';
import { pushSyncQueue } from './api.js';

let onStatusChange = () => {};
let onSyncErrors = () => {};

export function setSyncStatusListener(fn) {
  onStatusChange = fn;
}

// Appelé avec la liste des entrées de la file rejetées par le serveur (ex :
// donnée invalide). Ces entrées restent en file pour être revues plutôt que
// silencieusement perdues — voir syncNow().
export function setSyncErrorListener(fn) {
  onSyncErrors = fn;
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
// Par lots : seul le lot trop lourd est concerné, ce qui a déjà réussi
// avant lui reste acquis (retiré de la file), et l'échec pointe vers un
// sous-ensemble bien plus petit à examiner.
const SYNC_BATCH_SIZE = 5;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncNow() {
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

  let totalSynced = 0;
  const allErrors = [];
  let fatalError = null;

  for (const batch of chunk(queue, SYNC_BATCH_SIZE)) {
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
      totalSynced += result.synced;
      allErrors.push(...(result.errors || []));
    } catch (err) {
      // Ce lot précis échoue (ex : trop lourd, une photo dedans) et reste en
      // file pour la prochaine tentative — mais on continue avec les lots
      // suivants au lieu de s'arrêter là : un seul lot à problème ne doit
      // jamais bloquer la synchro de tout le reste de la file.
      if (!fatalError) fatalError = err;
    }
  }

  if (fatalError) {
    consecutiveFailures++;
    lastError = fatalError;
    await refreshSyncStatus();
    throw fatalError;
  }

  consecutiveFailures = 0;
  lastError = null;
  await refreshSyncStatus();
  if (allErrors.length > 0) {
    const failedIds = new Set(allErrors.map((e) => e.id));
    const failedItems = queue.filter((q) => failedIds.has(q.id));
    onSyncErrors(failedItems, allErrors);
  }
  return { synced: totalSynced, skipped: false, errors: allErrors };
}

window.addEventListener('online', () => { syncNow().catch(() => {}); });
window.addEventListener('offline', () => { refreshSyncStatus(); });
setInterval(() => { syncNow().catch(() => {}); }, 5 * 60 * 1000);
