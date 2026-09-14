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

export async function refreshSyncStatus() {
  const queue = await getSyncQueue();
  if (!navigator.onLine) {
    onStatusChange('offline', queue.length);
  } else if (queue.length > 0) {
    onStatusChange('pending', queue.length);
  } else {
    onStatusChange('synced', 0);
  }
  return queue.length;
}

export async function syncNow() {
  if (!navigator.onLine) {
    await refreshSyncStatus();
    return { synced: 0, skipped: true };
  }

  const queue = await getSyncQueue();
  if (queue.length === 0) {
    await refreshSyncStatus();
    return { synced: 0, skipped: false };
  }

  try {
    const result = await pushSyncQueue(queue);
    // Le serveur traite chaque entrée individuellement et peut en rejeter
    // certaines (ex : donnée invalide) sans faire échouer toute la requête.
    // Ne retirer de la file que ce qui a réellement été accepté : sinon une
    // entrée rejetée disparaît de la file locale sans jamais avoir atteint
    // la base partagée, perdue silencieusement.
    const failedIds = new Set((result.errors || []).map((e) => e.id));
    const succeededIds = queue.map((q) => q.id).filter((id) => !failedIds.has(id));
    await clearSyncQueueItems(succeededIds);
    await refreshSyncStatus();
    if (failedIds.size > 0) {
      const failedItems = queue.filter((q) => failedIds.has(q.id));
      onSyncErrors(failedItems, result.errors);
    }
    return { synced: result.synced, skipped: false, errors: result.errors || [] };
  } catch (err) {
    await refreshSyncStatus();
    throw err;
  }
}

window.addEventListener('online', () => { syncNow().catch(() => {}); });
window.addEventListener('offline', () => { refreshSyncStatus(); });
setInterval(() => { syncNow().catch(() => {}); }, 5 * 60 * 1000);
