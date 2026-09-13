import { getSyncQueue, clearSyncQueueItems } from './db.js';
import { pushSyncQueue } from './api.js';

let onStatusChange = () => {};

export function setSyncStatusListener(fn) {
  onStatusChange = fn;
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
    await clearSyncQueueItems(queue.map((q) => q.id));
    await refreshSyncStatus();
    return { synced: result.synced, skipped: false };
  } catch (err) {
    await refreshSyncStatus();
    throw err;
  }
}

window.addEventListener('online', () => { syncNow().catch(() => {}); });
window.addEventListener('offline', () => { refreshSyncStatus(); });
setInterval(() => { syncNow().catch(() => {}); }, 5 * 60 * 1000);
