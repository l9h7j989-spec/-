/*
 * store.js — 데이터 저장소 (브라우저 localStorage) + 백업 형식
 *
 * 데이터 구조 (version 2)
 * {
 *   version: 2,
 *   updatedAt: 마지막으로 내용을 바꾼 시각,
 *   settings: { kakaoKey, kakaoRestKey, office:{name,address,lat,lng}|null,
 *               supabaseUrl, supabaseKey, cloudSyncedAt, cloudLocalAt },
 *   clients: [ { id, name, type, address, lat, lng, contactName, phone, memo,
 *                status, placeId, createdAt, updatedAt } ],
 *   visits:  [ { id, clientId, date:'YYYY-MM-DD', memo, createdAt } ],
 *   today:   { date, stops:[ {id, clientId|'' , name, address, lat, lng, phone, doneDate} ],
 *              planned, recommended:[stopId], recommendedKm, method },
 *              ← stops 의 순서가 곧 방문 순서입니다.
 *   quotes:  [ { id, clientId|'', clientName, date, title, vat:'포함'|'별도',
 *                items:[{name, spec, qty, price, service}] (최대 6줄),
 *                desc(작업 내용), note(기타사항), sent, createdAt, updatedAt } ]
 * }
 */
(function (root) {
  'use strict';
  var KEY = 'schoolRoute.v1';
  var TYPES = ['초등학교', '중학교', '고등학교', '기관', '기타'];
  var STATUSES = ['미방문', '방문 완료', '견적 발송', '계약'];

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function str(v) { return v == null ? '' : String(v); }
  function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(str(v)); }

  function emptyToday() { return { date: todayStr(), stops: [], planned: false, recommended: null, recommendedKm: null, method: null }; }
  function empty() {
    return {
      version: 2, updatedAt: '',
      settings: { kakaoKey: '', kakaoRestKey: '', office: null, supabaseUrl: '', supabaseKey: '', cloudSyncedAt: '', cloudLocalAt: '' },
      clients: [], visits: [], today: emptyToday(), quotes: []
    };
  }

  /** 어떤 모양의 데이터가 들어와도 안전한 형태로 정리 (옛 버전·백업 불러오기에도 사용) */
  function normalize(raw) {
    var db = empty();
    if (!raw || typeof raw !== 'object') return db;
    db.updatedAt = str(raw.updatedAt);
    var s = raw.settings || {};
    db.settings.kakaoKey = str(s.kakaoKey).trim();
    db.settings.kakaoRestKey = str(s.kakaoRestKey).trim();
    db.settings.supabaseUrl = str(s.supabaseUrl).trim();
    db.settings.supabaseKey = str(s.supabaseKey).trim();
    db.settings.cloudSyncedAt = str(s.cloudSyncedAt);
    db.settings.cloudLocalAt = str(s.cloudLocalAt);
    if (s.office && num(s.office.lat) != null && num(s.office.lng) != null) {
      db.settings.office = { name: str(s.office.name), address: str(s.office.address), lat: num(s.office.lat), lng: num(s.office.lng) };
    }
    var ids = {}, byId = {};
    (Array.isArray(raw.clients) ? raw.clients : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || !str(c.name).trim()) return;
      var id = str(c.id) || uid();
      if (ids[id]) id = uid();
      ids[id] = true;
      var o = {
        id: id, name: str(c.name).trim(),
        type: TYPES.indexOf(c.type) >= 0 ? c.type : '기타',
        address: str(c.address), lat: num(c.lat), lng: num(c.lng),
        contactName: str(c.contactName), phone: str(c.phone), memo: str(c.memo),
        status: STATUSES.indexOf(c.status) >= 0 ? c.status : '미방문',
        placeId: str(c.placeId),
        createdAt: str(c.createdAt) || new Date().toISOString(),
        updatedAt: str(c.updatedAt) || new Date().toISOString()
      };
      byId[id] = o; db.clients.push(o);
    });
    (Array.isArray(raw.visits) ? raw.visits : []).forEach(function (v) {
      if (!v || !ids[str(v.clientId)] || !isDate(v.date)) return;
      db.visits.push({ id: str(v.id) || uid(), clientId: str(v.clientId), date: str(v.date), memo: str(v.memo), createdAt: str(v.createdAt) || new Date().toISOString() });
    });

    var t = raw.today || {}, T = db.today;
    T.date = isDate(t.date) ? t.date : todayStr();
    if (Array.isArray(t.stops)) {
      var seen = {};
      t.stops.forEach(function (p) {
        if (!p || num(p.lat) == null || num(p.lng) == null || !str(p.name).trim()) return;
        var id = str(p.id) || uid();
        if (seen[id]) return;
        seen[id] = true;
        T.stops.push({
          id: id, clientId: ids[str(p.clientId)] ? str(p.clientId) : '',
          name: str(p.name).trim(), address: str(p.address), lat: num(p.lat), lng: num(p.lng),
          phone: str(p.phone), doneDate: isDate(p.doneDate) ? p.doneDate : ''
        });
      });
      T.planned = !!t.planned && T.stops.length > 0;
      var rec = Array.isArray(t.recommended) ? t.recommended.map(str).filter(function (id) { return seen[id]; }) : null;
      T.recommended = rec && rec.length === T.stops.length ? rec : null;
      T.recommendedKm = T.recommended ? num(t.recommendedKm) : null;
      T.method = t.method === 'exact' || t.method === 'approx' ? t.method : null;
    } else {
      // 옛 버전(선택 목록 + 순서 목록) → 새 형식으로 옮김
      var order = Array.isArray(t.order) && t.order.length ? t.order : (Array.isArray(t.selected) ? t.selected : []);
      order.map(str).forEach(function (cid) {
        var c = byId[cid];
        if (!c || c.lat == null || c.lng == null) return;
        T.stops.push({ id: uid(), clientId: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone, doneDate: '' });
      });
      T.planned = Array.isArray(t.order) && t.order.length > 0 && T.stops.length > 0;
    }
    (Array.isArray(raw.quotes) ? raw.quotes : []).forEach(function (q) {
      if (!q || typeof q !== 'object' || !str(q.clientName).trim()) return;
      db.quotes.push({
        id: str(q.id) || uid(), clientId: ids[str(q.clientId)] ? str(q.clientId) : '', clientName: str(q.clientName).trim(),
        date: isDate(q.date) ? q.date : todayStr(), title: str(q.title), vat: q.vat === '별도' ? '별도' : '포함',
        items: (Array.isArray(q.items) ? q.items : []).slice(0, 6).map(function (it) {
          it = it || {};
          return { name: str(it.name), spec: str(it.spec), qty: num(it.qty), price: num(it.price), service: !!it.service };
        }),
        desc: str(q.desc), note: str(q.note), sent: !!q.sent,
        createdAt: str(q.createdAt) || new Date().toISOString(), updatedAt: str(q.updatedAt) || new Date().toISOString()
      });
    });
    return db;
  }

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return empty(); }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }
  }

  /* 연습용 샘플 — 실제 학교가 아닌 가상의 이름과 좌표입니다 (서울시청 주변) */
  var SAMPLE_OFFICE = { name: '(샘플) 사무실', address: '서울시청 부근 (연습용)', lat: 37.5663, lng: 126.9779 };
  var SAMPLE_CLIENTS = [
    { id: 'sample-1', name: '(샘플) 가나초등학교', type: '초등학교', lat: 37.5796, lng: 126.9770 },
    { id: 'sample-2', name: '(샘플) 다라중학교', type: '중학교', lat: 37.5512, lng: 126.9882 },
    { id: 'sample-3', name: '(샘플) 마바고등학교', type: '고등학교', lat: 37.5704, lng: 127.0090 },
    { id: 'sample-4', name: '(샘플) 사아초등학교', type: '초등학교', lat: 37.5563, lng: 126.9368 },
    { id: 'sample-5', name: '(샘플) 자차교육지원청', type: '기관', lat: 37.5850, lng: 127.0010 }
  ];

  root.Store = {
    TYPES: TYPES, STATUSES: STATUSES,
    SAMPLE_OFFICE: SAMPLE_OFFICE, SAMPLE_CLIENTS: SAMPLE_CLIENTS,
    todayStr: todayStr, uid: uid, empty: empty, emptyToday: emptyToday, normalize: normalize, load: load, save: save
  };
})(typeof self !== 'undefined' ? self : this);
