// Petit magasin clé → valeur dans IndexedDB pour les index d'enseignes.
// (localStorage est limité à ~5 Mo : trop peu pour 8 modèles × 279 vecteurs.)
const DB = 'gc-semantic';
const STORE = 'index';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Toutes les fonctions échouent en douceur (navigation privée, stockage bloqué…) : on recalcule simplement l'index.
export const idbGet = (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined);
export const idbSet = (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined);
export const idbDel = (k) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined);
export const idbKeys = () => tx('readonly', (s) => s.getAllKeys()).then((ks) => ks || []).catch(() => []);
