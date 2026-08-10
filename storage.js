const KEY = 'personal-ads-intelligence-workspaces-v2';
const ACTIVE = 'personal-ads-intelligence-active-workspace-v2';
const DB_NAME = 'personal-ads-intelligence-data-v1';
const DB_VERSION = 1;
const STORE_NAME = 'dashboard-state';
const DASHBOARD_KEY = 'current';

export function loadConfig() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function saveConfig(workspaces) { localStorage.setItem(KEY, JSON.stringify(workspaces)); }
export function activeId() { return localStorage.getItem(ACTIVE) || ''; }
export function setActiveId(id) { localStorage.setItem(ACTIVE, id); }
export function loadActions(workspaceId) { try { return JSON.parse(localStorage.getItem(`personal-ads-actions-${workspaceId}`) || '{}'); } catch { return {}; } }
export function saveActions(workspaceId, actions) { localStorage.setItem(`personal-ads-actions-${workspaceId}`, JSON.stringify(actions)); }

function openDataDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise(resolve => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function dataTransaction(mode, handler) {
  const db = await openDataDb();
  if (!db) return null;
  return new Promise(resolve => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, mode);
      const result = handler(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); resolve(null); };
      transaction.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Saves imported source rows in this browser only. Large records stay in IndexedDB, not localStorage. */
export async function saveDashboardData({ ads = [], leads = [], matches = [], source = '未导入' }) {
  const value = { ads, leads, matches, source, savedAt: new Date().toISOString() };
  return dataTransaction('readwrite', store => {
    store.put(value, DASHBOARD_KEY);
    return true;
  });
}

export async function loadDashboardData() {
  const db = await openDataDb();
  if (!db) return null;
  return new Promise(resolve => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(DASHBOARD_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function clearDashboardData() {
  return dataTransaction('readwrite', store => {
    store.delete(DASHBOARD_KEY);
    return true;
  });
}
