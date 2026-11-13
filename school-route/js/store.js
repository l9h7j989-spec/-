/*
 * store.js — 데이터 저장소 (브라우저 localStorage) + 백업
 *
 * 데이터 구조
 * {
 *   version: 1,
 *   settings: { kakaoKey, office: {name, address, lat, lng} | null },
 *   clients: [ { id, name, type, address, lat, lng, contactName, phone, memo,
 *                status, placeId, createdAt, updatedAt } ],
 *   visits:  [ { id, clientId, date:'YYYY-MM-DD', memo, createdAt } ],
 *   today:   { date, selected:[clientId], order:[clientId]|null,
 *              recommended:[clientId]|null, recommendedKm, method },
 *   quotes:  [ ]   ← 나중에 추가할 견적서 자리.
 *                    { id, clientId, date, items:[{name, qty, unitPrice}],
 *                      total, status, sentAt, memo } 형태로 쓰면
 *                    clientId 로 거래처 정보(이름·주소·담당자·연락처)를 끌어올 수 있습니다.
 * }
 */
(function (root) {
  'use strict';
  var KEY = 'schoolRoute.v1';
  var TYPES = ['초등학교', '중학교', '고등학교', '기관'];
  var STATUSES = ['미방문', '방문 완료', '견적 발송', '계약'];

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function str(v) { return v == null ? '' : String(v); }

  function empty() {
    return {
      version: 1,
      settings: { kakaoKey: '', office: null },
      clients: [], visits: [],
      today: { date: todayStr(), selected: [], order: null, recommended: null, recommendedKm: null, method: null },
      quotes: []
    };
  }

  /** 어떤 모양의 데이터가 들어와도 안전한 형태로 정리 (백업 불러오기에도 사용) */
  function normalize(raw) {
    var db = empty();
    if (!raw || typeof raw !== 'object') return db;
    var s = raw.settings || {};
    db.settings.kakaoKey = str(s.kakaoKey).trim();
    if (s.office && num(s.office.lat) != null && num(s.office.lng) != null) {
      db.settings.office = { name: str(s.office.name), address: str(s.office.address), lat: num(s.office.lat), lng: num(s.office.lng) };
    }
    var ids = {};
    (Array.isArray(raw.clients) ? raw.clients : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || !str(c.name).trim()) return;
      var id = str(c.id) || uid();
      if (ids[id]) id = uid();
      ids[id] = true;
      db.clients.push({
        id: id, name: str(c.name).trim(),
        type: TYPES.indexOf(c.type) >= 0 ? c.type : '기관',
        address: str(c.address), lat: num(c.lat), lng: num(c.lng),
        contactName: str(c.contactName), phone: str(c.phone), memo: str(c.memo),
        status: STATUSES.indexOf(c.status) >= 0 ? c.status : '미방문',
        placeId: str(c.placeId),
        createdAt: str(c.createdAt) || new Date().toISOString(),
        updatedAt: str(c.updatedAt) || new Date().toISOString()
      });
    });
    (Array.isArray(raw.visits) ? raw.visits : []).forEach(function (v) {
      if (!v || !ids[str(v.clientId)] || !/^\d{4}-\d{2}-\d{2}$/.test(str(v.date))) return;
      db.visits.push({ id: str(v.id) || uid(), clientId: str(v.clientId), date: str(v.date), memo: str(v.memo), createdAt: str(v.createdAt) || new Date().toISOString() });
    });
    var t = raw.today || {};
    var keep = function (arr) { return Array.isArray(arr) ? arr.map(str).filter(function (id) { return ids[id]; }) : null; };
    db.today.date = /^\d{4}-\d{2}-\d{2}$/.test(str(t.date)) ? t.date : todayStr();
    db.today.selected = keep(t.selected) || [];
    db.today.order = keep(t.order);
    db.today.recommended = keep(t.recommended);
    db.today.recommendedKm = num(t.recommendedKm);
    db.today.method = t.method === 'exact' || t.method === 'approx' ? t.method : null;
    db.quotes = (Array.isArray(raw.quotes) ? raw.quotes : []).filter(function (q) { return q && ids[str(q.clientId)]; });
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
    todayStr: todayStr, uid: uid, empty: empty, normalize: normalize, load: load, save: save
  };
})(typeof self !== 'undefined' ? self : this);
