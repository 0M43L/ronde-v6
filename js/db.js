// IndexedDB — stockage local offline-first.
const DB_NAME = 'ronde_v6';
const DB_VERSION = 3;
const STORES = ['substations', 'rondes', 'fiches', 'actions', 'mes', 'sync_queue', 'fiche_conflicts', 'network_plan'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(data);
    req.onsuccess = () => resolve(data);
    req.onerror = () => reject(req.error);
  });
}

export async function putAll(store, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const item of items) os.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ===== File d'attente de synchronisation =====
export async function queueSync(entity_type, action, payload) {
  // La plupart des payloads ont un .id, mais les opérations ciblées (ex :
  // ajout/retrait d'une photo de site) portent plutôt un .substation_id.
  const key = payload.id ?? payload.substation_id ?? 'x';
  // Date.now() seul (résolution à la milliseconde) peut produire deux fois
  // le même id pour la même entité (deux opérations très rapprochées, ex.
  // deux photos ajoutées au même site) : le second put() dans ce store
  // (keyPath 'id') écraserait alors silencieusement le premier, qui
  // disparaîtrait de la file sans jamais partir vers le serveur. Un suffixe
  // aléatoire élimine la collision sans dépendre de la précision du timer.
  const suffix = Math.random().toString(36).slice(2, 8);
  await put('sync_queue', { id: `${entity_type}_${key}_${Date.now()}_${suffix}`, entity_type, action, payload });
}

export async function getSyncQueue() {
  return getAll('sync_queue');
}

export async function clearSyncQueueItems(ids) {
  for (const id of ids) await remove('sync_queue', id);
}

// ===== Conflits de fiches en attente de fusion manuelle =====
export async function getFicheConflicts() {
  return getAll('fiche_conflicts');
}

export async function addFicheConflict(conflict) {
  await put('fiche_conflicts', conflict);
}

export async function removeFicheConflict(id) {
  await remove('fiche_conflicts', id);
}
