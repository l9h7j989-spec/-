/* 클라우드 동기화 (Supabase)
 * - 기기 안(IndexedDB)이 기본 저장소. 인터넷이 되면 클라우드와 주고받는다.
 * - 같은 기록을 두 기기에서 고치면 '나중에 고친 것'이 남는다.
 * - 사진·견적 양식 파일은 Supabase Storage 'photos' 버킷의 <사용자ID>/ 폴더에 올린다.
 */
const Cloud = (() => {
  const LS = 'plumbing-cloud-config';
  let client = null, user = null, syncing = null, timer = null;
  const statusListeners = [];
  const status = { state: 'off', lastSync: null, error: '' };

  function config() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { /* 무시 */ }
    const base = window.APP_CONFIG || {};
    return {
      supabaseUrl: saved.supabaseUrl || base.supabaseUrl || '',
      supabaseAnonKey: saved.supabaseAnonKey || base.supabaseAnonKey || '',
      kakaoRestKey: saved.kakaoRestKey || base.kakaoRestKey || '',
    };
  }
  function saveConfig(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) { /* 무시 */ } client = null; return init(); }
  function setStatus(p) { Object.assign(status, p); statusListeners.forEach((f) => f(status)); }

  async function init() {
    const c = config();
    if (!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) { setStatus({ state: 'off' }); return false; }
    if (!client) {
      client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      client.auth.onAuthStateChange((_e, session) => {
        user = session?.user || null;
        setStatus({ state: user ? 'on' : 'login' });
      });
    }
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    setStatus({ state: user ? 'on' : 'login', lastSync: await DB.getKV('lastSyncAt', null) });
    return !!user;
  }

  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await init(); return sync({ full: true });
  }
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    await init();
    return data.session ? 'ok' : 'confirm'; // 이메일 확인이 켜져 있으면 'confirm'
  }
  async function signOut() { await client.auth.signOut(); user = null; setStatus({ state: 'login' }); }

  const toRow = (kind, id, data, del) => ({
    user_id: user.id, kind, id, data: del ? null : data, deleted: !!del,
    client_updated: (data && data.updatedAt) || 0, // 시각 없는 옛 기록은 클라우드 것을 덮어쓰지 않음
  });

  async function push() {
    const dirty = (await DB.getKV('dirty', {})) || {};
    const entries = Object.entries(dirty);
    if (!entries.length) return 0;
    const rows = [];
    for (const [, d] of entries) {
      if (d.kind === 'settings') {
        const s = await DB.getKV('settings', null);
        rows.push(toRow('settings', 'main', s, !s));
      } else {
        const obj = d.del ? null : await DB.get(d.kind, d.id);
        rows.push(toRow(d.kind, d.id, obj, d.del || !obj));
        if (d.del || !obj) rows[rows.length - 1].client_updated = d.at;
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from('records').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
      if (error) throw error;
    }
    // 보내는 동안 새로 바뀐 것은 남겨둔다
    const now = (await DB.getKV('dirty', {})) || {};
    for (const [k, d] of entries) if (now[k] && now[k].at === d.at) delete now[k];
    await DB.put('kv', { k: 'dirty', v: now });
    return rows.length;
  }

  async function pull(full) {
    const since = full ? null : await DB.getKV('pullCursor', null);
    const dirty = (await DB.getKV('dirty', {})) || {};
    let changed = 0, cursor = since, from = 0;
    for (;;) {
      let q = client.from('records').select('kind,id,data,deleted,client_updated,updated_at')
        .order('updated_at', { ascending: true }).range(from, from + 999);
      // 동시에 저장된 기록을 놓치지 않도록 10초 겹쳐서 받는다
      if (since) q = q.gt('updated_at', new Date(new Date(since).getTime() - 10000).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      for (const r of data) {
        cursor = r.updated_at;
        const key = r.kind + ':' + r.id;
        if (r.kind === 'settings') {
          const local = await DB.getKV('settings', null);
          if (dirty[key] && local && (local.updatedAt || 0) >= r.client_updated) continue;
          if (r.deleted || !r.data) continue;
          if (local && (local.updatedAt || 0) >= r.client_updated) continue;
          await DB.setKV('settings', r.data, { fromSync: true }); changed++;
          await pullTemplate(r.data);
          continue;
        }
        if (!DB.SYNCED.includes(r.kind)) continue;
        const local = await DB.get(r.kind, r.id);
        const localAt = dirty[key] ? dirty[key].at : (local?.updatedAt || 0);
        if ((dirty[key] || local) && localAt >= r.client_updated) continue;
        if (r.deleted) { if (local) { await DB.del(r.kind, r.id, { fromSync: true }); changed++; } }
        else { await DB.put(r.kind, r.data, { fromSync: true }); changed++; }
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    if (cursor) await DB.put('kv', { k: 'pullCursor', v: cursor });
    return changed;
  }

  const photoPath = (id) => `${user.id}/${id}.jpg`;
  async function pushPhotos() {
    const q = (await DB.getKV('photoQueue', {})) || {};
    for (const [id, p] of Object.entries(q)) {
      if (p.del) {
        await client.storage.from('photos').remove([photoPath(id)]);
      } else {
        // 사진은 클라우드에 올리지 않는다(저장 공간 아끼기, 사용자 요청). 사진은 찍은 폰에만 남는다.
        // 예전에 올라가 있던 사진은 fetchPhoto 로 계속 받아볼 수 있고, 지우면 위에서 클라우드에서도 지워진다.
      }
      const now = (await DB.getKV('photoQueue', {})) || {};
      if (now[id] && now[id].del === p.del) delete now[id];
      await DB.put('kv', { k: 'photoQueue', v: now });
    }
  }
  // 이 기기에 없는 사진은 필요할 때 클라우드에서 받아온다
  async function fetchPhoto(id) {
    if (!client || !user) return null;
    const { data, error } = await client.storage.from('photos').download(photoPath(id));
    if (error || !data) return null;
    await DB.put('photos', { id, blob: data }, { fromSync: true });
    return data;
  }
  // 양식 파일: 한글 견적서(hwpx) / 엑셀 견적서(xls, 이름은 예전 그대로 xlsx 칸 사용) / 소견서(hwp)
  const TPL = {
    hwpx: { kv: 'template', nameKv: 'templateName', setting: 'templateName', type: 'application/hwp+zip' },
    hwp: { kv: 'opinionTemplate', nameKv: 'opinionTemplateName', setting: 'opinionTemplateName', type: 'application/x-hwp' },
    xlsx: { kv: 'xlsxTemplate', nameKv: 'xlsxTemplateName', setting: 'xlsxTemplateName', type: 'application/vnd.ms-excel' },
  };
  async function pushTemplate(buf, name, kind = 'hwpx') {
    if (!client || !user) return;
    await client.storage.from('photos').upload(`${user.id}/template.${kind}`, new Blob([buf]), { upsert: true, contentType: TPL[kind].type });
  }
  async function pullTemplate(settings) {
    for (const [kind, t] of Object.entries(TPL)) {
      const remoteName = settings[t.setting] || '';
      const localName = await DB.getKV(t.nameKv, '');
      if (remoteName === localName) continue;
      if (!remoteName) { await DB.del('kv', t.kv); await DB.del('kv', t.nameKv); continue; }
      const { data } = await client.storage.from('photos').download(`${user.id}/template.${kind}`);
      if (data) { await DB.setKV(t.kv, await data.arrayBuffer()); await DB.setKV(t.nameKv, remoteName); }
    }
  }

  // 이 기기에서 처음 로그인하면, 그동안 기기에만 있던 기록을 모두 올린다
  async function firstUpload() {
    if ((await DB.getKV('syncUser', null)) === user.id) return;
    for (const kind of DB.SYNCED) for (const r of await DB.all(kind)) await DB.markDirty(kind, r.id, false);
    if (await DB.getKV('settings', null)) await DB.markDirty('settings', 'main', false);
    const q = (await DB.getKV('photoQueue', {})) || {};
    for (const p of await DB.all('photos')) q[p.id] = { id: p.id, del: false };
    await DB.put('kv', { k: 'photoQueue', v: q });
    await DB.put('kv', { k: 'pullCursor', v: null });
    // 로그인 전에 이 폰에만 올려 둔 양식도 클라우드로
    for (const [kind, t] of Object.entries(TPL)) {
      const buf = await DB.getKV(t.kv, null), name = await DB.getKV(t.nameKv, '');
      if (buf && name) await pushTemplate(buf, name, kind);
    }
    await DB.put('kv', { k: 'syncUser', v: user.id });
  }

  async function sync(opt = {}) {
    if (!client || !user || !navigator.onLine) return { changed: 0, skipped: true };
    if (syncing) return syncing;
    syncing = (async () => {
      setStatus({ state: 'syncing', error: '' });
      try {
        await firstUpload();
        await push();
        await pushPhotos();
        const changed = await pull(opt.full || !(await DB.getKV('pullCursor', null)));
        const at = new Date().toISOString();
        await DB.put('kv', { k: 'lastSyncAt', v: at });
        setStatus({ state: 'on', lastSync: at });
        return { changed };
      } catch (e) {
        console.error(e);
        setStatus({ state: 'error', error: e.message || String(e) });
        return { changed: 0, error: e };
      } finally { syncing = null; }
    })();
    return syncing;
  }
  // 저장하면 3초 뒤 자동 동기화
  function scheduleSync() { clearTimeout(timer); timer = setTimeout(() => sync().then((r) => r.changed && Cloud.onRemoteChange && Cloud.onRemoteChange()), 3000); }

  async function invoke(fn, body) {
    const { data, error } = await client.functions.invoke(fn, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { /* 무시 */ }
      throw new Error(msg);
    }
    return data;
  }
  async function rpcDisconnect() { const { error } = await client.rpc('kakao_disconnect'); if (error) throw error; }
  async function kakaoStatus() {
    const { data, error } = await client.rpc('kakao_status');
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  return {
    config, saveConfig, init, signIn, signUp, signOut, sync, scheduleSync, fetchPhoto, pushTemplate,
    invoke, kakaoStatus, rpcDisconnect, status, onStatus: (f) => statusListeners.push(f),
    get user() { return user; }, get ready() { return !!(client && user); }, onRemoteChange: null,
  };
})();
