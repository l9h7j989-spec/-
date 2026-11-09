/* IndexedDB 저장소: 데이터는 이 기기(브라우저) 안에만 저장된다. */
const DB = (() => {
  const NAME = 'plumbing-biz';
  const STORES = ['jobs', 'todos', 'estimates', 'photos', 'kv'];
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    all: (store) => tx(store, 'readonly', (s) => req(s.getAll())),
    get: (store, id) => tx(store, 'readonly', (s) => req(s.get(id))),
    put: (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); return obj; }),
    del: (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); }),
    clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
    async getKV(k, def) { const r = await this.get('kv', k); return r ? r.v : def; },
    setKV(k, v) { return this.put('kv', { k, v }); },
    STORES,
  };
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
