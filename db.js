// ==========================================
// IndexedDB Wrapper (v2)
// ==========================================

const DB_NAME = 'DividendLedger';
const DB_VERSION = 2;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('holdings')) {
        db.createObjectStore('holdings', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('alerts')) {
        db.createObjectStore('alerts', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('priceCache')) {
        db.createObjectStore('priceCache', { keyPath: 'code' });
      }
    };
  });
  return dbPromise;
}

async function txGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function txPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txAdd(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function txClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  getHoldings: () => txGetAll('holdings'),
  addHolding: (h) => txAdd('holdings', h),
  updateHolding: (h) => txPut('holdings', h),
  deleteHolding: (id) => txDelete('holdings', id),

  getWatchlist: () => txGetAll('watchlist'),
  addWatch: (w) => txAdd('watchlist', w),
  deleteWatch: (id) => txDelete('watchlist', id),

  getAlerts: () => txGetAll('alerts'),
  addAlert: (a) => txAdd('alerts', a),
  updateAlert: (a) => txPut('alerts', a),
  deleteAlert: (id) => txDelete('alerts', id),

  getSetting: async (key) => {
    const r = await txGet('settings', key);
    return r ? r.value : null;
  },
  setSetting: (key, value) => txPut('settings', { key, value }),

  getPriceCache: () => txGetAll('priceCache'),
  getPrice: (code) => txGet('priceCache', code),
  setPrice: (p) => txPut('priceCache', p),

  // Firestoreからの同期用: 既存データを置き換え
  replaceStore: async (storeName, items) => {
    await txClear(storeName);
    for (const item of items) {
      await txPut(storeName, item);
    }
  },

  async seedIfEmpty() {
    const existing = await this.getHoldings();
    if (existing.length > 0) return;
    const seed = [
      { code:'7203', name:'トヨタ自動車', shares:100, cost:2500, div:75 },
      { code:'8306', name:'三菱UFJフィナンシャル・グループ', shares:500, cost:900, div:41 },
      { code:'9432', name:'日本電信電話', shares:200, cost:155, div:5.2 },
    ];
    for (const h of seed) await this.addHolding(h);

    const watches = [
      { code:'9433', name:'KDDI', memo:'増配継続中' },
      { code:'4502', name:'武田薬品工業', memo:'高配当銘柄' },
    ];
    for (const w of watches) await this.addWatch(w);
  },

  async exportAll() {
    return {
      holdings: await this.getHoldings(),
      watchlist: await this.getWatchlist(),
      alerts: await this.getAlerts(),
      exportedAt: new Date().toISOString(),
    };
  },
  async importAll(data) {
    if (data.holdings) {
      for (const h of data.holdings) {
        delete h.id;
        await this.addHolding(h);
      }
    }
    if (data.watchlist) {
      for (const w of data.watchlist) {
        delete w.id;
        await this.addWatch(w);
      }
    }
    if (data.alerts) {
      for (const a of data.alerts) {
        delete a.id;
        await this.addAlert(a);
      }
    }
  }
};

window.DB = DB;
