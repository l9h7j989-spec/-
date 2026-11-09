/* IndexedDB 저장소 (기기 안 저장)
 * 클라우드 동기화를 위해 jobs/todos/estimates/settings 변경은 '보낼 목록(dirty)'에 기록한다.
 * 동기화가 받아온 값은 { fromSync: true } 로 저장해서 다시 보내지 않는다. */
const DB = (() => {
  const NAME = 'plumbing-biz';
  const STORES = ['jobs', 'todos', 'estimates', 'photos', 'kv'];
  const SYNCED = ['jobs', 'todos', 'estimates'];
  let dbp;
  const listeners = [];
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

  // 보낼 목록: kv 'dirty' = { "jobs:abc": { kind, id, del, at } }
  async function markDirty(kind, id, del) {
    const cur = (await api.getKV('dirty', {})) || {};
    cur[kind + ':' + id] = { kind, id, del: !!del, at: Date.now() };
    await api.put('kv', { k: 'dirty', v: cur });
    listeners.forEach((f) => f(kind, id));
  }
  async function queuePhoto(id, del) {
    const cur = (await api.getKV('photoQueue', {})) || {};
    cur[id] = { id, del: !!del };
    await api.put('kv', { k: 'photoQueue', v: cur });
    listeners.forEach((f) => f('photos', id));
  }

  const api = {
    all: (store) => tx(store, 'readonly', (s) => req(s.getAll())),
    get: (store, id) => tx(store, 'readonly', (s) => req(s.get(id))),
    async put(store, obj, opt = {}) {
      if (!opt.fromSync && SYNCED.includes(store)) obj.updatedAt = Date.now();
      await tx(store, 'readwrite', (s) => { s.put(obj); });
      if (opt.fromSync) return obj;
      if (SYNCED.includes(store)) await markDirty(store, obj.id, false);
      else if (store === 'photos') await queuePhoto(obj.id, false);
      return obj;
    },
    async del(store, id, opt = {}) {
      await tx(store, 'readwrite', (s) => { s.delete(id); });
      if (opt.fromSync) return;
      if (SYNCED.includes(store)) await markDirty(store, id, true);
      else if (store === 'photos') await queuePhoto(id, true);
    },
    clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
    async getKV(k, def) { const r = await this.get('kv', k); return r ? r.v : def; },
    async setKV(k, v, opt = {}) {
      await this.put('kv', { k, v });
      if (k === 'settings' && !opt.fromSync) {
        v.updatedAt = Date.now();
        await this.put('kv', { k, v });
        await markDirty('settings', 'main', false);
      }
    },
    onChange(f) { listeners.push(f); },
    markDirty, STORES, SYNCED,
  };
  return api;
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
