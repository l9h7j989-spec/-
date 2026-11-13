/*
 * app.js — 화면 동작 (거래처 / 영업 / 서류 / 설정)
 * 계산은 route.js, 저장은 store.js, 카카오는 kakao.js, 구글 드라이브는 drive.js 가 맡습니다.
 */
(function () {
  'use strict';
  var TYPES = Store.TYPES, STATUSES = Store.STATUSES;
  var TYPE_SHORT = { '초등학교': '초', '중학교': '중', '고등학교': '고', '기관': '기관', '기타': '기타' };
  var TABS = [['clients', '거래처', 'building'], ['sales', '영업', 'route'], ['docs', '서류', 'doc'], ['settings', '설정', 'sliders']];

  var db = Store.load();
  // 구글 클라이언트 ID: 앱에 넣어 둔 값(config.js) 또는 "다른 기기용 링크"(#gid=...)로 받는다
  var CONFIG_GID = (window.AppConfig && String(window.AppConfig.GOOGLE_CLIENT_ID || '').trim()) || '';
  (function () {
    var m = /[#&]gid=([^&]+)/.exec(location.hash), gid = CONFIG_GID || (m ? decodeURIComponent(m[1]).trim() : '');
    if (m) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
    if (gid && gid !== db.settings.googleClientId) { db.settings.googleClientId = gid; Store.save(db); }
  })();
  var ui = { tab: 'clients', q: '', sort: 'recent', fType: '전체', fStatus: '전체', sheet: null, sg: null, drivePaused: false, driveBusy: false, driveError: '' };
  var map = null, overlays = [], lines = [], salesSeq = 0, sgSeq = 0, sgTimer = null, toastTimer = null, driveTimer = null;
  var roadCache = {}, roadFail = {};

  /* ---------- 아이콘 ---------- */
  var IC = {
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3"/>',
    route: '<circle cx="6" cy="19" r="2.500"/><circle cx="18" cy="5" r="2.500"/><path d="M8.500 19H15a3.500 3.500 0 0 0 0-7H9a3.500 3.500 0 0 1 0-7h6.500"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    phone: '<path d="M5 4h3l2 5-2.500 1.500a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.600 7.100L4 20l1-4.600A8 8 0 1 1 21 12z"/>',
    nav: '<path d="M12 3l7 18-7-4-7 4z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    grip: '<path d="M5 9h14M5 15h14"/>',
    cloud: '<path d="M7 18a4.500 4.500 0 0 1-.500-9A6 6 0 0 1 18 10.500a3.800 3.800 0 0 1-.500 7.500z"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    car: '<path d="M5 16l1.500-6a2 2 0 0 1 2-1.500h7a2 2 0 0 1 2 1.500L19 16M3 16h18v3H3zM7 19v1.500M17 19v1.500"/>',
    up: '<path d="M6 14l6-6 6 6"/>', down: '<path d="M6 10l6 6 6-6"/>',
    pin: '<path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>'
  };
  function icon(n, size, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>';
  }

  /* ---------- 작은 도구들 ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtKm(km) { return km.toFixed(1) + 'km'; }
  function fmtMin(min) { var m = Math.max(1, Math.round(min)); return m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''); }
  function shortDate(d) { return d ? d.slice(5).replace('-', '.') : ''; }
  function hasPos(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function byId(id) { return db.clients.find(function (c) { return c.id === id; }); }
  function stopById(id) { return db.today.stops.find(function (s) { return s.id === id; }); }
  function visitsOf(id) { return db.visits.filter(function (v) { return v.clientId === id; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); }); }
  function visitedToday(id) { var d = Store.todayStr(); return db.visits.some(function (v) { return v.clientId === id && v.date === d; }); }
  function stopDone(s) { return s.clientId ? visitedToday(s.clientId) : s.doneDate === Store.todayStr(); }
  function telHref(p) { return 'tel:' + String(p).replace(/[^0-9+*#]/g, ''); }
  function smsHref(p) { return 'sms:' + String(p).replace(/[^0-9+]/g, ''); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }
  function save() {
    db.updatedAt = new Date().toISOString();
    if (!Store.save(db)) toast('저장에 실패했습니다. 휴대폰 저장 공간이나 브라우저의 사생활 보호 모드를 확인해 주세요.');
    renderNav(); scheduleDrive();
  }
  function copyText(text, label) {
    var ok = function () { toast((label || '주소를') + ' 복사했습니다.'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) ok(); else toast('복사하지 못했습니다.'); } catch (e) { toast('복사하지 못했습니다.'); }
      ta.remove();
    };
    if (!text) return toast('복사할 주소가 없습니다.');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  function guessType(name) {
    if (/초등학교|초교/.test(name)) return '초등학교';
    if (/중학교/.test(name)) return '중학교';
    if (/고등학교|고교/.test(name)) return '고등학교';
    if (/교육청|교육지원청|주민센터|행정복지센터|구청|시청|군청|도청|센터|공단|공사|도서관|유치원|어린이집|대학/.test(name)) return '기관';
    return '기타';
  }

  /* ---------- 이름이 정확하지 않아도 찾는 검색 ---------- */
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function norm(s) { return String(s || '').toLowerCase().replace(/[\s()\-·.,]/g, ''); }
  function chosung(s) {
    return norm(s).replace(/[가-힣]/g, function (ch) { return CHO[Math.floor((ch.charCodeAt(0) - 0xAC00) / 588)]; });
  }
  /** 0 = 안 맞음. 숫자가 클수록 잘 맞음 */
  function matchScore(text, q) {
    var t = norm(text), k = norm(q);
    if (!k) return 0;
    if (t.indexOf(k) === 0) return 100;
    if (t.indexOf(k) > 0) return 80;
    if (/^[ㄱ-ㅎ]+$/.test(k) && chosung(text).indexOf(k) >= 0) return 60;
    if (k.length >= 2) { // 글자가 순서대로 들어 있으면 (예: "가초" → 가나초등학교)
      for (var i = 0, j = 0; i < t.length && j < k.length; i++) if (t[i] === k[j]) j++;
      if (j === k.length) return 40;
    }
    return 0;
  }
  function matchClients(q) {
    return db.clients.map(function (c) {
      return { c: c, s: Math.max(matchScore(c.name, q), matchScore(c.contactName, q) * 0.7, norm(c.address).indexOf(norm(q)) >= 0 && norm(q).length >= 2 ? 30 : 0, norm(c.memo).indexOf(norm(q)) >= 0 && norm(q).length >= 2 ? 20 : 0) };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s || a.c.name.localeCompare(b.c.name, 'ko'); }).map(function (r) { return r.c; });
  }

  /* ---------- 탭·제목 ---------- */
  function renderNav() {
    var n = db.today.stops.length;
    document.querySelectorAll('#nav button').forEach(function (b, i) {
      var t = TABS[i];
      b.className = t[0] === ui.tab ? 'on' : '';
      if (t[0] === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.innerHTML = icon(t[2], 25) + '<span>' + t[1] + '</span>' + (t[0] === 'sales' && n ? '<b class="cnt">' + n + '</b>' : '');
    });
  }
  function renderHeader() {
    $('#title').textContent = TABS.filter(function (t) { return t[0] === ui.tab; })[0][1];
    var a = '';
    if (db.settings.googleClientId) {
      var st = driveStatus();
      a += '<button class="round ' + (st.ok ? 'soft' : 'warn') + '" data-act="drive-tap" aria-label="구글 드라이브: ' + st.text + '">' + icon('cloud', 22) + '</button>';
    }
    if (ui.tab === 'clients') a += '<button class="round pri" data-act="new" aria-label="거래처 추가">' + icon('plus', 24) + '</button>';
    $('#top-act').innerHTML = a;
    var bar = $('#syncbar'), need = db.settings.googleClientId && !Drive.connected();
    bar.hidden = !need;
    if (need) bar.innerHTML = icon('cloud', 18) + '<span>로그인하면 다른 기기와 내용이 맞춰집니다</span><b>로그인</b>';
    var lm = $('#login-msg'); if (lm) lm.textContent = ui.driveError || '';
  }
  function switchTab(tab) {
    ui.tab = tab; ui.sg = null;
    TABS.forEach(function (t) { $('#tab-' + t[0]).hidden = t[0] !== tab; });
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    renderNav(); renderHeader();
    if (ui.tab === 'clients') renderClients();
    else if (ui.tab === 'sales') renderSales();
    else if (ui.tab === 'docs') renderDocs();
    else renderSettings();
  }

  /* ================= 거래처 ================= */
  function seg(act, pairs, cur, cls) {
    return '<div class="segc' + (cls ? ' ' + cls : '') + '">' + pairs.map(function (p) {
      var v = Array.isArray(p) ? p[0] : p, label = Array.isArray(p) ? p[1] : p;
      return '<button type="button" class="' + (v === cur ? 'on' : '') + '" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (v === cur) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
  }
  function renderClients() {
    var h = '<div class="searchbar">' + icon('search', 20) + '<input id="q" type="search" placeholder="이름 · 담당자 · 주소 검색" value="' + esc(ui.q) + '" autocomplete="off" enterkeyhint="search"></div>';
    h += '<div style="height:10px"></div>' + seg('sort', [['recent', '최신순'], ['type', '구분별'], ['near', '가까운순']], ui.sort);
    h += '<div class="chips">' + ['전체'].concat(TYPES).map(function (v) {
      var n = v === '전체' ? db.clients.length : db.clients.filter(function (c) { return c.type === v; }).length;
      return '<button class="chip' + (v === ui.fType ? ' on' : '') + '" data-act="ftype" data-v="' + v + '">' + (TYPE_SHORT[v] || v) + '<small>' + n + '</small></button>';
    }).join('') +
      '<select id="f-status" class="chip' + (ui.fStatus !== '전체' ? ' on' : '') + '" aria-label="영업 상태로 거르기">' + ['전체'].concat(STATUSES).map(function (v) {
        return '<option value="' + v + '"' + (v === ui.fStatus ? ' selected' : '') + '>' + (v === '전체' ? '상태 전체' : v) + '</option>';
      }).join('') + '</select></div>';
    h += '<div id="client-list"></div>';
    $('#tab-clients').innerHTML = h;
    renderClientList();
  }
  function clientRow(c, km) {
    var last = visitsOf(c.id)[0];
    var sub = [];
    if (c.contactName) sub.push(esc(c.contactName));
    sub.push('<span class="badge st-' + STATUSES.indexOf(c.status) + '">' + c.status + '</span>');
    if (last) sub.push('최근 방문 ' + shortDate(last.date));
    return '<div class="row">' +
      '<button class="row-main" data-act="open" data-id="' + c.id + '">' +
      '<span class="ava t' + TYPES.indexOf(c.type) + '">' + TYPE_SHORT[c.type] + '</span>' +
      '<span class="row-txt"><span class="row-t">' + esc(c.name) + '</span><span class="row-s">' + sub.join(' · ') + '</span>' +
      (c.address ? '<span class="row-a">' + esc(c.address) + '</span>' : '') + '</span></button>' +
      (km != null ? '<span class="km">' + fmtKm(km) + '</span>' : '') +
      (c.phone ? '<a class="round soft" href="' + telHref(c.phone) + '" aria-label="' + esc(c.name) + ' 담당자에게 전화">' + icon('phone', 21) + '</a>' : '') +
      '</div>';
  }
  function renderClientList() {
    var el = $('#client-list'), office = db.settings.office, q = ui.q.trim();
    if (!db.clients.length) {
      el.innerHTML = '<div class="empty"><img class="em-logo" src="logo.png" alt=""><b>아직 거래처가 없습니다</b>오른쪽 위 ＋ 를 눌러 첫 거래처를 등록하세요.<br><br><button class="btn pri" data-act="new">' + icon('plus', 20) + '거래처 추가</button></div>';
      return;
    }
    var list = q ? matchClients(q) : db.clients.slice();
    list = list.filter(function (c) { return (ui.fType === '전체' || c.type === ui.fType) && (ui.fStatus === '전체' || c.status === ui.fStatus); });
    if (!list.length) { el.innerHTML = '<div class="empty"><b>조건에 맞는 거래처가 없습니다</b>검색어나 구분을 바꿔 보세요.</div>'; return; }
    var km = function (c) { return office && hasPos(c) ? Route.haversineKm(office, c) : null; };
    var h = '';
    if (ui.sort === 'near' && !office) h += '<div class="notice">사무실 위치를 정하면 가까운 순서로 볼 수 있습니다. <b>설정</b>에서 사무실을 지정해 주세요.</div>';
    if (ui.sort === 'type') {
      TYPES.forEach(function (t) {
        var g = list.filter(function (c) { return c.type === t; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
        if (!g.length) return;
        h += '<div class="sec-h"><span><b>' + t + '</b><span class="n">' + g.length + '</span></span></div><div class="group">' + g.map(function (c) { return clientRow(c, null); }).join('') + '</div>';
      });
    } else {
      if (ui.sort === 'near') {
        list = list.map(function (c) { return { c: c, km: km(c) }; }).sort(function (a, b) {
          if (a.km == null && b.km == null) return a.c.name.localeCompare(b.c.name, 'ko');
          return a.km == null ? 1 : b.km == null ? -1 : a.km - b.km;
        });
        h += '<div class="group">' + list.map(function (r) { return clientRow(r.c, r.km); }).join('') + '</div>';
      } else {
        if (!q) list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
        h += '<div class="group">' + list.map(function (c) { return clientRow(c, null); }).join('') + '</div>';
      }
    }
    el.innerHTML = h;
  }

  /* ---------- 거래처 창 (보기 / 편집) ---------- */
  function openClient(id) {
    if (!byId(id)) return;
    ui.sheet = { mode: 'view', id: id };
    showSheet();
  }
  function editClient(id, prefill, linkStop) {
    var c = id ? byId(id) : null;
    var d = c ? JSON.parse(JSON.stringify(c)) : Object.assign({ id: Store.uid(), name: '', type: '초등학교', address: '', lat: null, lng: null, contactName: '', phone: '', memo: '', status: '미방문', placeId: '' }, prefill || {});
    ui.sheet = { mode: 'edit', id: d.id, isNew: !c, draft: d, original: JSON.stringify(d), linkStop: linkStop || '', results: null };
    ui.sg = null;
    showSheet();
  }
  function showSheet() { renderSheet(); $('#sheet').hidden = false; $('#sheet').scrollTop = 0; document.body.classList.add('lock'); }
  function renderSheet() { if (ui.sheet) $('#sheet').innerHTML = ui.sheet.mode === 'view' ? viewHtml() : ui.sheet.mode === 'quote' ? quoteHtml() : editHtml(); }
  function kv(k, v, extra) { return '<div class="kv"><span class="k">' + k + '</span><span class="v' + (v ? '' : ' none') + '">' + (v || '없음') + '</span>' + (extra || '') + '</div>'; }
  function viewHtml() {
    var c = byId(ui.sheet.id), vs = visitsOf(c.id), pos = hasPos(c);
    var inToday = db.today.stops.some(function (s) { return s.clientId === c.id; });
    var h = '<div class="bar"><button data-act="sheet-close">닫기</button><button class="strong" data-act="edit" data-id="' + c.id + '">편집</button></div><div class="in">';
    h += '<div class="hero"><span class="ava big t' + TYPES.indexOf(c.type) + '">' + TYPE_SHORT[c.type] + '</span><h2>' + esc(c.name) + '</h2><p>' + c.type + ' · 등록 ' + c.createdAt.slice(0, 10) + '</p></div>';
    h += '<div class="quick">' +
      '<a class="pill' + (c.phone ? '' : ' off') + '" href="' + (c.phone ? telHref(c.phone) : '#') + '">' + icon('phone') + '전화</a>' +
      '<a class="pill' + (c.phone ? '' : ' off') + '" href="' + (c.phone ? smsHref(c.phone) : '#') + '">' + icon('msg') + '문자</a>' +
      '<a class="pill' + (pos ? '' : ' off') + '" target="_blank" rel="noopener" href="' + (pos ? KakaoApi.navLink(c) : '#') + '">' + icon('nav') + '길안내</a>' +
      '<button class="pill' + (inToday ? ' on' : '') + '" data-act="add-today" data-id="' + c.id + '"' + (pos ? '' : ' disabled') + '>' + icon(inToday ? 'check' : 'route') + (inToday ? '영업에 담김' : '영업에 추가') + '</button></div>';
    h += '<div class="group">' +
      kv('담당자', esc(c.contactName)) +
      kv('연락처', c.phone ? '<a href="' + telHref(c.phone) + '">' + esc(c.phone) + '</a>' : '') +
      kv('주소', esc(c.address), c.address ? '<button class="round" data-act="copy" data-v="' + esc(c.address) + '" aria-label="주소 복사">' + icon('copy', 20) + '</button>' : '') +
      kv('메모', esc(c.memo)) + '</div>';
    if (!pos) h += '<div class="notice">위치(좌표)가 없어 거리 계산과 영업 동선에 넣을 수 없습니다. <b>편집</b>에서 이름을 검색하거나 주소로 위치를 찾아 주세요.</div>';
    h += '<button class="btn soft wide" style="margin-bottom:4px" data-act="quote-new" data-id="' + c.id + '">' + icon('doc', 20) + '이 거래처로 견적서 작성</button>';
    h += '<div class="sec-h"><b>영업 상태</b></div>' + seg('quick-status', STATUSES, c.status, 'brand-on');
    h += '<div class="sec-h"><span><b>방문 기록</b><span class="n">' + vs.length + '</span></span></div><div class="group pad">' +
      '<input id="v-date" type="date" value="' + Store.todayStr() + '" aria-label="방문 날짜"><textarea id="v-memo" placeholder="방문 메모 (예: 행정실장 면담, 견적 요청 받음)" style="margin-top:8px"></textarea>' +
      '<button class="btn soft wide" style="margin-top:8px" data-act="add-visit">' + icon('plus', 20) + '방문 기록 추가</button></div>';
    if (vs.length) h += '<div class="group">' + vs.map(function (v) {
      return '<div class="visit"><span class="d">' + v.date + '</span><span class="m">' + (esc(v.memo) || '메모 없음') + '</span><button class="btn plain danger" data-act="del-visit" data-id="' + v.id + '">삭제</button></div>';
    }).join('') + '</div>';
    h += '<button class="btn danger wide" style="margin-top:10px" data-act="sheet-delete">이 거래처 삭제</button></div>';
    return h;
  }
  function editHtml() {
    var s = ui.sheet, d = s.draft;
    var h = '<div class="bar"><button data-act="sheet-close">취소</button><h2>' + (s.isNew ? '새 거래처' : '거래처 편집') + '</h2><button class="strong" data-act="sheet-save">저장</button></div><div class="in">';
    h += '<label class="f" for="f-name">이름</label><div class="searchbar">' + icon('search', 20) + '<input id="f-name" type="text" value="' + esc(d.name) + '" placeholder="학교·기관 이름 (일부만 써도 추천됩니다)" data-suggest="client" autocomplete="off"></div><div id="sg-client" class="sg"></div>';
    h += '<label class="f" for="f-address">주소</label><input id="f-address" type="text" value="' + esc(d.address) + '" placeholder="추천에서 고르면 자동 입력됩니다" data-enter="search-addr" autocomplete="off">';
    h += '<div class="row2" style="margin-top:8px"><button class="btn small" data-act="search-addr">' + icon('pin', 18) + '주소로 위치 찾기</button>' + (d.address ? '<button class="btn small fit" data-act="copy" data-v="' + esc(d.address) + '">' + icon('copy', 18) + '복사</button>' : '') + '</div>';
    if (s.results) h += resultsHtml(s.results);
    h += hasPos(d) ? '<div class="pos yes">' + icon('check', 18) + '위치 확인됨</div>' : '<div class="pos no">' + icon('pin', 18) + '위치 없음 — 추천 목록에서 고르거나 주소로 찾아 주세요</div>';
    h += '<label class="f">구분</label>' + seg('set-type', TYPES.map(function (t) { return [t, TYPE_SHORT[t]]; }), d.type, 'brand-on');
    h += '<label class="f" for="f-contact">담당자</label><input id="f-contact" type="text" value="' + esc(d.contactName) + '" placeholder="예: 행정실 김○○ 주무관" autocomplete="off">';
    h += '<label class="f" for="f-phone">담당자 연락처</label><input id="f-phone" type="tel" value="' + esc(d.phone) + '" placeholder="010-0000-0000" autocomplete="off">';
    h += '<label class="f">영업 상태</label>' + seg('set-status', STATUSES, d.status, 'brand-on');
    h += '<label class="f" for="f-memo">메모</label><textarea id="f-memo" placeholder="청소 면적, 계약 시기, 특이사항 등">' + esc(d.memo) + '</textarea>';
    h += '<button class="btn pri wide big" style="margin-top:18px" data-act="sheet-save">저장</button></div>';
    return h;
  }
  function resultsHtml(list) {
    if (!list.length) return '<div class="notice" style="margin-top:8px">주소를 찾지 못했습니다. 도로명 주소나 지번 주소를 다시 확인해 주세요.</div>';
    return '<div class="sg"><div class="group">' + list.map(function (r, i) {
      return '<div class="row"><button class="row-main" data-act="pick-addr" data-i="' + i + '"><span class="row-txt"><span class="row-t">' + esc(r.name) + '</span></span></button></div>';
    }).join('') + '</div></div>';
  }
  function syncDraft() {
    var s = ui.sheet; if (!s || s.mode !== 'edit' || !$('#f-name')) return;
    var d = s.draft;
    d.name = $('#f-name').value.trim(); d.address = $('#f-address').value.trim();
    d.contactName = $('#f-contact').value.trim(); d.phone = $('#f-phone').value.trim(); d.memo = $('#f-memo').value;
  }
  function closeSheet(force) {
    var s = ui.sheet;
    if (s && s.mode === 'quote') {
      syncQuote();
      if (!force && JSON.stringify(s.draft) !== s.original && !confirm('저장하지 않은 내용이 있습니다. 그냥 닫을까요?')) return;
    }
    if (s && s.mode === 'edit') {
      syncDraft();
      if (!force && JSON.stringify(s.draft) !== s.original && !confirm('저장하지 않은 내용이 있습니다. 그냥 닫을까요?')) return;
      if (!s.isNew && byId(s.id)) { ui.sheet = { mode: 'view', id: s.id }; ui.sg = null; return renderSheet(); }
    }
    ui.sheet = null; ui.sg = null;
    $('#sheet').hidden = true; $('#sheet').innerHTML = ''; document.body.classList.remove('lock');
    render();
  }
  function saveSheet() {
    syncDraft();
    var s = ui.sheet, d = s.draft;
    if (!d.name) return toast('이름을 입력해 주세요.');
    if (!hasPos(d) && !confirm('위치(좌표)가 없습니다.\n이대로 저장하면 거리 표시와 영업 동선에 넣을 수 없습니다.\n그래도 저장할까요?')) return;
    d.updatedAt = new Date().toISOString();
    if (s.isNew) { d.createdAt = d.updatedAt; db.clients.push(d); }
    else db.clients[db.clients.findIndex(function (c) { return c.id === d.id; })] = d;
    // 오늘 영업 목록에 담긴 같은 거래처 정보도 맞춘다
    var link = s.linkStop && stopById(s.linkStop);
    if (link) {
      link.clientId = d.id;
      if (link.doneDate) { db.visits.push({ id: Store.uid(), clientId: d.id, date: link.doneDate, memo: '', createdAt: new Date().toISOString() }); if (d.status === '미방문') d.status = '방문 완료'; link.doneDate = ''; }
    }
    db.today.stops.forEach(function (p) {
      if (p.clientId !== d.id) return;
      p.name = d.name; p.address = d.address; p.phone = d.phone;
      if (hasPos(d) && (p.lat !== d.lat || p.lng !== d.lng)) { p.lat = d.lat; p.lng = d.lng; db.today.recommended = null; }
    });
    save(); toast('저장했습니다.');
    ui.sheet = { mode: 'view', id: d.id }; ui.sg = null;
    renderSheet(); $('#sheet').scrollTop = 0;
  }
  function deleteClient() {
    var c = byId(ui.sheet.id);
    if (!confirm('"' + c.name + '" 거래처를 삭제할까요?\n방문 기록도 함께 지워집니다.')) return;
    db.clients = db.clients.filter(function (x) { return x.id !== c.id; });
    db.visits = db.visits.filter(function (v) { return v.clientId !== c.id; });
    db.quotes.forEach(function (q) { if (q.clientId === c.id) q.clientId = ''; });
    db.today.stops.forEach(function (p) { if (p.clientId === c.id) p.clientId = ''; });
    save(); toast('삭제했습니다.');
    ui.sheet = null; $('#sheet').hidden = true; $('#sheet').innerHTML = ''; document.body.classList.remove('lock'); render();
  }
  function searchAddr() {
    syncDraft();
    var s = ui.sheet;
    if (!s.draft.address) return toast('주소를 먼저 입력해 주세요.');
    toast('주소 찾는 중…');
    KakaoApi.geocode(s.draft.address).then(function (list) {
      if (ui.sheet !== s) return;
      syncDraft();
      if (list.length === 1) { applyAddr(list[0]); toast('위치를 찾았습니다.'); return; }
      s.results = list; renderSheet();
    }).catch(function (e) { toast(e.message); });
  }
  function applyAddr(r) {
    var d = ui.sheet.draft;
    d.address = r.address; d.lat = r.lat; d.lng = r.lng;
    ui.sheet.results = null; renderSheet();
  }
  function applyPlace(r) {
    syncDraft();
    var s = ui.sheet, d = s.draft;
    d.name = r.name; d.address = r.address; d.lat = r.lat; d.lng = r.lng; d.placeId = r.placeId || '';
    if (!d.phone && r.phone) d.phone = r.phone;
    if (s.isNew) d.type = guessType(r.name);
    s.results = null; ui.sg = null; renderSheet();
  }
  function addVisit() {
    var c = byId(ui.sheet.id), date = $('#v-date').value, memo = $('#v-memo').value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('방문 날짜를 골라 주세요.');
    db.visits.push({ id: Store.uid(), clientId: c.id, date: date, memo: memo, createdAt: new Date().toISOString() });
    if (c.status === '미방문') c.status = '방문 완료';
    save(); renderSheet(); toast('방문 기록을 추가했습니다.');
  }

  /* ================= 추천 검색 (입력하는 대로 목록이 뜸) ================= */
  function onSuggestInput(input) {
    var kind = input.dataset.suggest, q = input.value.trim(), my = ++sgSeq;
    clearTimeout(sgTimer);
    if (!q) { ui.sg = null; return renderSg(kind); }
    var local = kind === 'sales' ? matchClients(q).filter(hasPos).slice(0, 5).map(function (c) {
      return { clientId: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone, placeId: c.placeId };
    }) : [];
    ui.sg = { kind: kind, q: q, local: local, places: null, note: '' };
    if (kind === 'quote') { ui.sg.local = matchClients(q).slice(0, 6).map(function (c) { return { clientId: c.id, name: c.name, address: c.address }; }); ui.sg.places = []; ui.sg.note = '거래처에 없는 이름입니다. 쓴 그대로 견적서에 들어갑니다.'; return renderSg(kind); }
    if (KakaoApi.state.status !== 'ready') {
      ui.sg.places = [];
      ui.sg.note = KakaoApi.state.status === 'loading' ? '카카오맵 연결 중입니다…' : '설정에서 카카오 키를 넣으면 등록하지 않은 곳도 이름으로 찾을 수 있습니다.';
      return renderSg(kind);
    }
    if (q.length < 2) { ui.sg.places = []; ui.sg.note = '두 글자 이상 입력하면 추천이 나옵니다.'; return renderSg(kind); }
    renderSg(kind);
    sgTimer = setTimeout(function () {
      var jobs = [KakaoApi.searchPlaces(q, 8).catch(function () { return []; })];
      if (kind === 'office') jobs.push(KakaoApi.geocode(q).catch(function () { return []; }));
      Promise.all(jobs).then(function (r) {
        if (my !== sgSeq || !ui.sg) return;
        ui.sg.places = (r[1] || []).slice(0, 3).concat(r[0]);
        renderSg(kind);
      });
    }, 350);
  }
  function sgItems() {
    var g = ui.sg; if (!g) return [];
    var seen = {};
    g.local.forEach(function (x) { seen[x.placeId ? 'p' + x.placeId : 'n' + norm(x.name)] = true; seen['n' + norm(x.name)] = true; });
    var places = (g.places || []).filter(function (p) { return !(p.placeId && seen['p' + p.placeId]) && !seen['n' + norm(p.name)]; });
    return g.local.concat(places);
  }
  function renderSg(kind) {
    var box = $('#sg-' + kind); if (!box) return;
    var g = ui.sg;
    if (!g || g.kind !== kind) { box.innerHTML = ''; return; }
    var items = sgItems(), office = db.settings.office, h = '';
    g.items = items;
    h += items.map(function (r, i) {
      var km = office && kind !== 'office' && hasPos(r) ? Route.haversineKm(office, r) : null;
      return '<div class="row"><button class="row-main" data-act="sg-pick" data-i="' + i + '">' +
        '<span class="row-txt"><span class="row-t">' + esc(r.name) + '</span>' + (r.address && r.address !== r.name ? '<span class="row-a">' + esc(r.address) + '</span>' : '') + '</span></button>' +
        (r.clientId ? '<span class="tag">내 거래처</span>' : '') + (km != null ? '<span class="km">' + fmtKm(km) + '</span>' : '') + '</div>';
    }).join('');
    if (g.places === null) h += '<div class="sg-note">검색 중…</div>';
    else if (!items.length) h += '<div class="sg-note">' + (g.note || '"' + esc(g.q) + '" 검색 결과가 없습니다. 이름을 조금 바꿔 보세요.') + '</div>';
    else if (g.note && kind === 'sales') h += '<div class="sg-note">' + g.note + '</div>';
    box.innerHTML = '<div class="group">' + h + '</div>';
  }
  function pickSuggestion(i) {
    var g = ui.sg; if (!g || !g.items || !g.items[i]) return;
    var r = g.items[i];
    if (g.kind === 'sales') { addStop(r); }
    else if (g.kind === 'client') applyPlace(r);
    else if (g.kind === 'quote') { syncQuote(); ui.sheet.draft.clientId = r.clientId; ui.sheet.draft.clientName = r.name; ui.sg = null; renderSheet(); }
    else if (g.kind === 'office') {
      db.settings.office = { name: r.name, address: r.address, lat: r.lat, lng: r.lng };
      db.today.recommended = null; ui.sg = null; save(); renderSettings();
      toast('사무실을 "' + r.name + '"(으)로 정했습니다.');
    }
  }

  /* ================= 영업 (오늘의 동선) ================= */
  function addStop(r) {
    var t = db.today;
    var dup = t.stops.some(function (s) { return (r.clientId && s.clientId === r.clientId) || (norm(s.name) === norm(r.name) && Math.abs(s.lat - r.lat) < 1e-5 && Math.abs(s.lng - r.lng) < 1e-5); });
    if (dup) { toast('이미 오늘 목록에 있습니다.'); return false; }
    var clientId = r.clientId || '';
    if (!clientId) { // 같은 장소가 이미 내 거래처면 연결
      var c = db.clients.find(function (c) { return (r.placeId && c.placeId === r.placeId) || norm(c.name) === norm(r.name); });
      if (c) clientId = c.id;
    }
    if (!t.stops.length) t.date = Store.todayStr();
    t.stops.push({ id: Store.uid(), clientId: clientId, name: r.name, address: r.address || '', lat: r.lat, lng: r.lng, phone: r.phone || '', doneDate: '' });
    t.planned = false; t.recommended = null; t.recommendedKm = null; t.method = null;
    ui.sg = null; save();
    toast(r.name + ' 추가 (' + t.stops.length + '곳)');
    if (ui.tab === 'sales') { renderSales(); var q = $('#sales-q'); if (q) q.focus(); }
    return true;
  }
  function removeStop(id) {
    var t = db.today;
    t.stops = t.stops.filter(function (s) { return s.id !== id; });
    t.recommended = null; t.recommendedKm = null;
    if (!t.stops.length) t.planned = false;
    save(); renderSalesBody();
  }
  function resetToday() {
    if (!db.today.stops.length) return;
    if (!confirm('오늘 영업 목록을 모두 비울까요?\n(거래처와 방문 기록은 지워지지 않습니다)')) return;
    db.today = Store.emptyToday();
    save(); renderSales();
  }
  function renderSales() {
    var office = db.settings.office, t = db.today, h = '';
    if (t.stops.length && t.date !== Store.todayStr()) h += '<div class="notice">이 목록은 <b>' + t.date + '</b>에 만든 것입니다. 오늘 새로 시작하려면 <b>목록 비우기</b>를 누르세요.</div>';
    h += '<button class="office" data-act="go-settings">' + '<span class="o-ic">' + icon('home', 20) + '</span>' +
      '<span class="o-t"><small>출발 · 도착 (차량 이동)</small><b>' + (office ? esc(office.name) : '사무실을 먼저 정해 주세요') + '</b></span>' + icon('chev', 20, 'chev') + '</button>';
    h += '<div class="searchbar">' + icon('search', 20) + '<input id="sales-q" type="search" placeholder="오늘 영업할 곳 검색해서 추가" data-suggest="sales" autocomplete="off" enterkeyhint="search"></div><div id="sg-sales" class="sg"></div>';
    $('#sales-top').innerHTML = h;
    renderSalesBody();
  }
  function stopRowPlain(s, i) {
    return '<div class="row"><div class="row-main" style="padding-right:0"><span class="ava t' + (s.clientId && byId(s.clientId) ? TYPES.indexOf(byId(s.clientId).type) : 4) + '" style="width:34px;height:34px;border-radius:50%">' + (i + 1) + '</span>' +
      '<span class="row-txt"><span class="row-t">' + esc(s.name) + '</span><span class="row-a">' + esc(s.address) + '</span></span></div>' +
      '<button class="round" data-act="copy" data-v="' + esc(s.address) + '" aria-label="' + esc(s.name) + ' 주소 복사">' + icon('copy', 20) + '</button>' +
      '<button class="round" data-act="remove-stop" data-id="' + s.id + '" aria-label="' + esc(s.name) + ' 빼기">' + icon('x', 20) + '</button></div>';
  }
  function roadKey(pts) { return pts.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join('|'); }
  function fullRouteLink(office, stops) {
    var sg = function (p) { return encodeURIComponent(String(p.name).replace(/[,\/]/g, ' ')) + ',' + p.lat + ',' + p.lng; };
    return 'https://map.kakao.com/link/by/car/' + [office].concat(stops, [office]).map(sg).join('/');
  }
  function renderSalesBody() {
    var my = ++salesSeq, t = db.today, office = db.settings.office, stops = t.stops;
    var sum = $('#sales-sum'), list = $('#sales-list'), wrap = $('#map-wrap');
    if (!stops.length) {
      wrap.hidden = true; list.innerHTML = '';
      sum.innerHTML = '<div class="empty"><img class="em-logo" src="logo.png" alt=""><b>오늘 영업할 곳을 추가하세요</b>위 검색칸에 이름 일부만 써도 추천이 나옵니다.<br>모두 추가한 뒤 <b>동선 짜기</b>를 누르면<br>가장 짧은 순서를 계산해 지도에 보여 줍니다.</div>';
      return;
    }
    if (!t.planned || !office) {
      wrap.hidden = true; list.innerHTML = '';
      sum.innerHTML = '<div class="sec-h"><span><b>오늘 영업할 곳</b><span class="n">' + stops.length + '</span></span><button class="btn plain danger" data-act="reset-today">목록 비우기</button></div>' +
        '<div class="group">' + stops.map(stopRowPlain).join('') + '</div>' +
        (office ? '' : '<div class="notice">동선은 사무실에서 출발해 사무실로 돌아옵니다. 위의 <b>출발 · 도착</b>을 눌러 사무실을 먼저 정해 주세요.</div>') +
        '<button class="btn pri wide big" data-act="plan"' + (office ? '' : ' disabled') + '>' + icon('route', 22) + '동선 짜기</button>' +
        '<p class="hint" style="text-align:center">' + (stops.length <= Route.EXACT_LIMIT ? '모든 순서를 따져 가장 짧은 순서를 찾습니다.' : stops.length + '곳은 근사 계산으로 빠르게 찾습니다.') + '</p>';
      return;
    }
    var pts = [office].concat(stops, [office]);
    Route.buildMatrix([office].concat(stops)).then(function (m) {
      if (my !== salesSeq) return;
      var idx = stops.map(function (_, i) { return i + 1; });
      var legs = Route.legs(m, idx), total = Route.tourLength(m, idx);
      var key = roadKey(pts), road = roadCache[key], restKey = db.settings.kakaoRestKey;
      var done = stops.filter(stopDone).length;

      var h = '<div class="sum"><div class="lbl">' + (road ? '차로 이동 · 사무실 출발 → 사무실 도착' : '총 이동 거리 · 사무실 출발 → 사무실 도착') + '</div>';
      h += road ? '<div class="big">' + road.km.toFixed(1) + '<small>km</small><span>약 ' + fmtMin(road.min) + '</span></div>' : '<div class="big">' + total.toFixed(1) + '<small>km</small><span>직선거리</span></div>';
      h += '<div class="bar" role="img" aria-label="방문 ' + done + '/' + stops.length + '"><i style="width:' + Math.round(done / stops.length * 100) + '%"></i></div>';
      var note;
      if (!t.recommended) note = '방문지나 사무실이 바뀌었습니다. 다시 짜면 순서를 새로 계산합니다.';
      else if (t.recommended.join() === stops.map(function (s) { return s.id; }).join()) note = t.method === 'exact' ? '직선거리 기준으로 모든 순서를 따져 고른 가장 짧은 순서입니다.' : Route.EXACT_LIMIT + '곳이 넘어 근사 계산한 순서입니다. 가장 짧은 순서와 조금 다를 수 있습니다.';
      else note = '직접 바꾼 순서입니다. 추천 순서보다 직선거리 ' + (total - t.recommendedKm >= 0 ? '+' : '') + fmtKm(total - t.recommendedKm);
      h += '<div class="sub">방문 ' + done + '/' + stops.length + ' · ' + note + '</div>';
      if (road) h += '<div class="sub">거리와 시간은 카카오 길찾기 기준이며 교통 상황에 따라 달라집니다. (직선거리 ' + fmtKm(total) + ')</div>';
      else if (!restKey) h += '<div class="sub">실제 도로 거리는 이보다 깁니다. 설정에 카카오 REST API 키를 넣으면 자동차 경로와 예상 시간을 보여 줍니다.</div>';
      else if (roadFail[key]) h += '<div class="sub">' + esc(roadFail[key]) + ' 직선거리로 표시합니다.</div>';
      else h += '<div class="sub">자동차 경로를 불러오는 중…</div>';
      if (t.recommended && t.recommended.join() !== stops.map(function (s) { return s.id; }).join()) h += '<button class="btn small wide" data-act="restore-rec">추천 순서로 되돌리기</button>';
      h += '</div>';
      sum.innerHTML = h;

      var legHtml = function (i) {
        return '<div class="leg">' + icon('car', 16) + (road ? '<b>' + fmtKm(road.legs[i].km) + '</b> · ' + fmtMin(road.legs[i].min) : '직선 <b>' + fmtKm(legs[i]) + '</b>') + '</div>';
      };
      var b = '<div class="depot"><span class="dot">' + icon('home', 16) + '</span>출발 · ' + esc(office.name || '사무실') + '</div><div id="stops">';
      stops.forEach(function (s, i) {
        var dn = stopDone(s);
        b += '<div class="stop' + (dn ? ' done' : '') + '" data-id="' + s.id + '">' + legHtml(i) +
          '<div class="stop-top"><button class="handle" aria-label="끌어서 순서 바꾸기">' + icon('grip', 20) + '</button><span class="no">' + (i + 1) + '</span>' +
          '<span class="nm"><b>' + esc(s.name) + '</b><small>' + esc(s.address) + '</small></span>' +
          '<span class="mv"><button data-act="up" data-id="' + s.id + '" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>' + icon('up', 16) + '</button><button data-act="down" data-id="' + s.id + '" aria-label="아래로"' + (i === stops.length - 1 ? ' disabled' : '') + '>' + icon('down', 16) + '</button></span></div>' +
          '<div class="acts"><button class="pill" data-act="navi" data-id="' + s.id + '">' + icon('car', 20) + '카카오내비</button>' +
          '<a class="pill" target="_blank" rel="noopener" href="' + KakaoApi.navLink(s) + '">' + icon('nav', 20) + '카카오맵</a>' +
          '<button class="pill" data-act="copy" data-v="' + esc(s.address) + '">' + icon('copy', 20) + '주소 복사</button>' +
          (s.phone ? '<a class="pill" href="' + telHref(s.phone) + '">' + icon('phone', 20) + '전화</a>' : '') +
          '<button class="pill ' + (dn ? 'on' : 'ok') + '" data-act="visit-toggle" data-id="' + s.id + '">' + icon('check', 20) + (dn ? '완료됨' : '방문 완료') + '</button></div>' +
          '<div class="stop-foot"><button class="btn plain danger" data-act="remove-stop" data-id="' + s.id + '">목록에서 빼기</button>' +
          (s.clientId ? '<button class="btn plain" data-act="open" data-id="' + s.clientId + '">거래처 정보</button>' : '<button class="btn plain" data-act="register-stop" data-id="' + s.id + '">' + icon('plus', 16) + '거래처로 등록</button>') + '</div></div>';
      });
      b += '</div><div class="depot"><span class="dot">' + icon('home', 16) + '</span>도착 · ' + esc(office.name || '사무실') + legHtml(stops.length) + '</div>';
      b += '<p class="hint">순서 바꾸기: 왼쪽 손잡이를 누른 채 위아래로 끌거나 화살표를 누르세요.</p>';
      b += '<div class="row2" style="margin-top:6px"><button class="btn soft" data-act="plan">' + icon('route', 20) + '동선 다시 짜기</button><button class="btn danger" data-act="reset-today">목록 비우기</button></div>';
      if (stops.length <= 5) b += '<a class="btn wide" style="margin-top:8px" target="_blank" rel="noopener" href="' + fullRouteLink(office, stops) + '">' + icon('nav', 20) + '전체 경로를 카카오맵에서 열기</a>';
      list.innerHTML = b;
      drawMap(office, stops, road);

      if (!road && restKey && !roadFail[key]) {
        KakaoApi.roadRoute(restKey, pts).then(function (r) { roadCache[key] = r; }, function (e) { roadFail[key] = e.message; })
          .then(function () { if (my === salesSeq && ui.tab === 'sales') renderSalesBody(); });
      }
    });
  }
  function plan() {
    var t = db.today, office = db.settings.office, stops = t.stops.slice();
    if (!office || !stops.length) return;
    Route.buildMatrix([office].concat(stops)).then(function (m) {
      var r = Route.solve(m);
      t.stops = r.order.map(function (i) { return stops[i - 1]; });
      t.recommended = t.stops.map(function (s) { return s.id; });
      t.recommendedKm = r.km; t.method = r.method; t.planned = true; t.date = Store.todayStr();
      save(); renderSalesBody();
      toast('동선을 짰습니다. ' + stops.length + '곳 · 직선 ' + fmtKm(r.km));
      setTimeout(function () { var el = $('#sales-sum'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    });
  }
  function moveStop(id, delta) {
    var o = db.today.stops, i = o.findIndex(function (s) { return s.id === id; }), j = i + delta;
    if (i < 0 || j < 0 || j >= o.length) return;
    o.splice(j, 0, o.splice(i, 1)[0]);
    save(); renderSalesBody();
  }
  function toggleVisit(id) {
    var s = stopById(id), d = Store.todayStr();
    if (s.clientId) {
      var c = byId(s.clientId);
      if (visitedToday(c.id)) {
        // 메모를 적어 둔 기록은 실수로 지워지지 않게 여기서는 건드리지 않는다
        var blank = db.visits.filter(function (v) { return v.clientId === c.id && v.date === d && !v.memo; });
        if (!blank.length) return toast('오늘 방문 기록에 메모가 있습니다. 지우려면 "거래처 정보"의 방문 기록에서 삭제해 주세요.');
        if (!confirm('"' + c.name + '"의 오늘 방문 완료 표시를 취소할까요?')) return;
        db.visits = db.visits.filter(function (v) { return blank.indexOf(v) < 0; });
        if (c.status === '방문 완료' && !visitsOf(c.id).length) c.status = '미방문';
      } else {
        db.visits.push({ id: Store.uid(), clientId: c.id, date: d, memo: '', createdAt: new Date().toISOString() });
        if (c.status === '미방문') c.status = '방문 완료';
        toast(c.name + ' — 오늘 방문 기록을 남겼습니다.');
      }
    } else {
      s.doneDate = s.doneDate === d ? '' : d;
      if (s.doneDate) toast('방문 완료로 표시했습니다. 거래처로 등록하면 기록이 계속 남습니다.');
    }
    save(); renderSalesBody();
  }
  function drawMap(office, stops, road) {
    var wrap = $('#map-wrap'), el = $('#map'), msg = $('#map-msg');
    wrap.hidden = false;
    if (KakaoApi.state.status !== 'ready') {
      el.hidden = true;
      msg.textContent = KakaoApi.state.status === 'loading' ? '지도를 불러오는 중…' : (KakaoApi.state.message || '설정에서 카카오 키를 넣으면 여기에 지도가 나옵니다. 순서와 거리는 지도 없이도 계산됩니다.');
      return;
    }
    el.hidden = false;
    msg.textContent = road ? '검은 점은 사무실, 번호는 방문 순서입니다. 초록 선은 자동차 경로입니다.' : '검은 점은 사무실, 번호는 방문 순서입니다. 선은 직선으로 이은 것이라 실제 도로와 다릅니다.';
    var K = kakao.maps;
    if (!map) map = new K.Map(el, { center: new K.LatLng(office.lat, office.lng), level: 6 });
    map.relayout();
    overlays.forEach(function (o) { o.setMap(null); }); overlays = [];
    lines.forEach(function (l) { l.setMap(null); }); lines = [];
    var bounds = new K.LatLngBounds(), straight = [];
    var add = function (p, html, z) {
      var pos = new K.LatLng(p.lat, p.lng);
      bounds.extend(pos); straight.push(pos);
      overlays.push(new K.CustomOverlay({ map: map, position: pos, content: html, xAnchor: 0.5, yAnchor: 0.5, zIndex: z }));
    };
    add(office, '<div class="mk office">' + icon('home', 15) + '</div>', 3);
    stops.forEach(function (s, i) { add(s, '<div class="mk' + (stopDone(s) ? ' done' : '') + '">' + (i + 1) + '</div>', 2); });
    straight.push(straight[0]);
    var path = road ? road.path.map(function (p) { var pos = new K.LatLng(p.lat, p.lng); bounds.extend(pos); return pos; }) : straight;
    lines.push(new K.Polyline({ map: map, path: path, strokeWeight: 8, strokeColor: '#ffffff', strokeOpacity: 0.9, strokeStyle: 'solid' }));
    lines.push(new K.Polyline({ map: map, path: path, strokeWeight: 5, strokeColor: '#12903f', strokeOpacity: 0.95, strokeStyle: road ? 'solid' : 'shortdash' }));
    map.setBounds(bounds);
  }

  /* 손으로 끌어서 순서 바꾸기 */
  function initDrag() {
    var body = $('#sales-list'), drag = null;
    body.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.handle'); if (!h) return;
      e.preventDefault();
      var item = h.closest('.stop');
      drag = { item: item, startY: e.clientY, list: item.parentNode, id: e.pointerId };
      try { h.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      item.classList.add('dragging');
    });
    body.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var it = drag.item, before, dy = e.clientY - drag.startY;
      var prev = it.previousElementSibling, next = it.nextElementSibling;
      // 옆 칸과 자리를 바꾸면 내 칸이 움직이는 거리의 절반을 넘었을 때만 바꾼다
      var upBy = prev ? it.offsetTop - prev.offsetTop : 0;
      var downBy = next ? (next.offsetTop + next.offsetHeight) - (it.offsetTop + it.offsetHeight) : 0;
      if (prev && dy < -upBy / 2) {
        before = it.offsetTop; drag.list.insertBefore(it, prev); drag.startY -= before - it.offsetTop;
      } else if (next && dy > downBy / 2) {
        before = it.offsetTop; drag.list.insertBefore(next, it); drag.startY += it.offsetTop - before;
      }
      it.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
      var step = 0;
      if (e.clientY < 130) step = -14; else if (e.clientY > window.innerHeight - 150) step = 14;
      if (step) { var y0 = window.scrollY; window.scrollBy(0, step); drag.startY -= window.scrollY - y0; }
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var ids = Array.prototype.map.call(drag.list.querySelectorAll('.stop'), function (n) { return n.dataset.id; });
      drag = null;
      var cur = db.today.stops;
      if (ids.join() !== cur.map(function (s) { return s.id; }).join()) {
        db.today.stops = ids.map(function (id) { return cur.find(function (s) { return s.id === id; }); });
        save();
      }
      renderSalesBody();
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
  }

  /* ================= 서류 (견적서) ================= */
  function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }
  function blankItem() { return { name: '', spec: '', qty: 1, price: null, service: false }; }
  function quoteById(id) { return db.quotes.find(function (q) { return q.id === id; }); }
  function renderDocs() {
    var has = Quote.hasTemplate(), h = '';
    h += '<div class="group pad">' + (has ?
      '<div class="pos yes" style="margin-top:0">' + icon('check', 18) + '견적서 양식이 등록되어 있습니다</div><p class="hint" style="margin:6px 0 10px">양식 파일은 이 휴대폰 안에만 저장됩니다.</p><button class="btn small" data-act="tpl-pick">양식 파일 바꾸기</button>' :
      '<div class="pos no" style="margin-top:0">' + icon('doc', 18) + '견적서 양식을 먼저 올려 주세요</div><p class="hint" style="margin:6px 0 10px">내용이 비어 있는 <b>견적서 양식 엑셀 파일</b>을 한 번만 올리면, 로고·도장·서식이 그대로인 견적서를 만들 수 있습니다. 파일은 이 휴대폰 안에만 저장됩니다.</p><button class="btn pri wide" data-act="tpl-pick">' + icon('plus', 20) + '양식 파일 올리기</button>') + '</div>';
    h += '<button class="btn pri wide big" data-act="quote-new">' + icon('plus', 22) + '새 견적서</button>';
    var list = db.quotes.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
    if (!list.length) h += '<div class="empty"><img class="em-logo" src="logo.png" alt=""><b>작성한 견적서가 없습니다</b>거래처를 고르고 품목과 금액만 넣으면<br>원본 양식 그대로 엑셀 파일이 만들어집니다.</div>';
    else h += '<div class="sec-h"><span><b>견적서</b><span class="n">' + list.length + '</span></span></div><div class="group">' + list.map(function (q) {
      return '<div class="row"><button class="row-main" data-act="quote-open" data-id="' + q.id + '"><span class="ava t' + (q.sent ? 0 : 4) + '">' + icon('doc', 20) + '</span>' +
        '<span class="row-txt"><span class="row-t">' + esc(q.clientName) + '</span><span class="row-s">' + q.date + ' · ' + won(Quote.total(q)) + (q.sent ? ' · <span class="badge st-3">발송</span>' : '') + '</span>' +
        (q.title ? '<span class="row-a">' + esc(q.title) + '</span>' : '') + '</span></button>' + icon('chev', 18, 'chev') + '</div>';
    }).join('') + '</div>';
    $('#tab-docs').innerHTML = h;
  }
  function openQuote(id, client, from) {
    var q = id ? quoteById(id) : null;
    var d = q ? JSON.parse(JSON.stringify(q)) : Object.assign({ id: Store.uid(), clientId: client ? client.id : '', clientName: client ? client.name : '', date: Store.todayStr(), title: '', vat: '포함', items: [blankItem()], desc: '', note: '', sent: false }, from || {});
    if (!d.items.length) d.items.push(blankItem());
    ui.sheet = { mode: 'quote', id: d.id, isNew: !q, draft: d, original: from ? '' : JSON.stringify(d) };
    ui.sg = null; showSheet();
  }
  function quoteHtml() {
    var s = ui.sheet, d = s.draft, h = '';
    h += '<div class="bar"><button data-act="sheet-close">닫기</button><h2>' + (s.isNew ? '새 견적서' : '견적서') + '</h2><button class="strong" data-act="quote-save">저장</button></div><div class="in">';
    h += '<label class="f" for="qf-client">받는 곳</label><div class="searchbar">' + icon('search', 20) + '<input id="qf-client" type="text" value="' + esc(d.clientName) + '" placeholder="거래처 이름 검색" data-suggest="quote" autocomplete="off"></div><div id="sg-quote" class="sg"></div>';
    h += '<p class="hint">' + (d.clientId && byId(d.clientId) ? '내 거래처와 연결됨 · 견적서에는 "' + esc(d.clientName) + ' 貴中"으로 들어갑니다.' : '견적서에는 쓴 이름 뒤에 "貴中"이 붙습니다.') + '</p>';
    h += '<div class="row2"><div><label class="f" for="qf-date">견적일</label><input id="qf-date" type="date" value="' + d.date + '"></div><div><label class="f">부가세 표시</label>' + seg('quote-vat', [['포함', 'VAT 포함'], ['별도', 'VAT 별도']], d.vat, 'brand-on') + '</div></div>';
    h += '<label class="f" for="qf-title">견적 제목</label><input id="qf-title" type="text" value="' + esc(d.title) + '" placeholder="예: 후드, 급식홀 바닥, 천장 복원세정" autocomplete="off">';
    h += '<div class="sec-h"><span><b>품목</b><span class="n">' + d.items.length + '/' + Quote.MAX_ITEMS + '</span></span></div>';
    d.items.forEach(function (it, i) {
      h += '<div class="group pad qitem"><div class="row2"><input type="text" data-k="name" data-i="' + i + '" value="' + esc(it.name) + '" placeholder="' + (i + 1) + '. 품목 (예: 조리실 후드)" aria-label="품목 ' + (i + 1) + '" autocomplete="off">' +
        '<button class="round fit" data-act="quote-del-item" data-i="' + i + '" aria-label="품목 ' + (i + 1) + ' 지우기">' + icon('x', 18) + '</button></div>';
      if (!it.service) h += '<div class="row2" style="margin-top:8px"><input type="text" data-k="spec" data-i="' + i + '" value="' + esc(it.spec) + '" placeholder="규격" aria-label="규격" autocomplete="off">' +
        '<input type="text" inputmode="numeric" data-k="qty" data-i="' + i + '" value="' + (it.qty == null ? '' : it.qty) + '" placeholder="수량" aria-label="수량" autocomplete="off">' +
        '<input type="text" inputmode="numeric" data-k="price" data-i="' + i + '" value="' + (it.price == null ? '' : Number(it.price).toLocaleString('ko-KR')) + '" placeholder="단가(원)" aria-label="단가" autocomplete="off" style="flex:1.6"></div>';
      h += '<label class="switch" style="padding:10px 2px 0;min-height:0"><span style="font-size:.88rem">서비스로 진행 (금액 없음)</span><input type="checkbox" data-k="service" data-i="' + i + '"' + (it.service ? ' checked' : '') + '></label></div>';
    });
    if (d.items.length < Quote.MAX_ITEMS) h += '<button class="btn soft wide" data-act="quote-add-item">' + icon('plus', 20) + '품목 추가</button>';
    else h += '<p class="hint">양식에 품목 칸이 6줄이라 6개까지 넣을 수 있습니다.</p>';
    h += '<div class="sum" style="margin-top:14px"><div class="lbl">견적 금액 (VAT ' + d.vat + ')</div><div class="big" id="q-total">' + won(Quote.total(d)) + '</div></div>';
    h += '<label class="f" for="qf-desc">작업 내용 (견적서 아래 칸)</label><textarea id="qf-desc" style="min-height:150px" placeholder="1. 후드 복원세정작업&#10;* 스팀세척기 살균 소독&#10;* 후드 고압 세척">' + esc(d.desc) + '</textarea>';
    h += '<label class="f" for="qf-note">기타사항</label><textarea id="qf-note" placeholder="없으면 비워 두세요">' + esc(d.note) + '</textarea>';
    h += '<button class="btn pri wide big" style="margin-top:18px" data-act="quote-export">' + icon('doc', 22) + '엑셀 파일로 받기</button>';
    if (canShareFiles()) h += '<button class="btn soft wide" style="margin-top:8px" data-act="quote-share">' + icon('msg', 20) + '엑셀 파일 공유 (카카오톡 · 메일)</button>';
    if (!Quote.hasTemplate()) h += '<p class="hint">엑셀로 받으려면 서류 화면에서 견적서 양식 파일을 먼저 올려야 합니다.</p>';
    if (!s.isNew) h += '<div class="row2" style="margin-top:8px"><button class="btn" data-act="quote-sent">' + (d.sent ? '발송 표시 취소' : '발송 완료로 표시') + '</button><button class="btn" data-act="quote-copy">복사해서 새 견적</button></div>' +
      '<button class="btn danger wide" style="margin-top:8px" data-act="quote-delete">이 견적서 삭제</button>';
    return h + '</div>';
  }
  function toNum(v) { var n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; }
  function syncQuote() {
    var s = ui.sheet; if (!s || s.mode !== 'quote' || !$('#qf-client')) return;
    var d = s.draft;
    d.clientName = $('#qf-client').value.trim(); d.date = $('#qf-date').value || d.date;
    d.title = $('#qf-title').value.trim(); d.desc = $('#qf-desc').value; d.note = $('#qf-note').value;
    document.querySelectorAll('#sheet [data-k]').forEach(function (el) {
      var it = d.items[+el.dataset.i], k = el.dataset.k; if (!it) return;
      if (k === 'service') it.service = el.checked;
      else if (k === 'qty' || k === 'price') it[k] = toNum(el.value);
      else it[k] = el.value.trim();
    });
  }
  /** 저장. 성공하면 저장된 견적을 돌려줌 */
  function saveQuote(quiet) {
    syncQuote();
    var s = ui.sheet, d = s.draft;
    if (!d.clientName) { toast('받는 곳을 입력해 주세요.'); return null; }
    d.items = d.items.filter(function (it) { return it.name; });
    if (!d.items.length) { d.items.push(blankItem()); renderSheet(); toast('품목을 하나 이상 넣어 주세요.'); return null; }
    d.updatedAt = new Date().toISOString();
    if (s.isNew) { d.createdAt = d.updatedAt; db.quotes.push(d); s.isNew = false; }
    else db.quotes[db.quotes.findIndex(function (q) { return q.id === d.id; })] = d;
    s.draft = JSON.parse(JSON.stringify(d)); s.original = JSON.stringify(s.draft);
    save(); renderSheet();
    if (!quiet) toast('견적서를 저장했습니다.');
    return d;
  }
  function canShareFiles() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.xlsx', { type: XLSX_TYPE })] })); } catch (e) { return false; }
  }
  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function exportQuote(share) {
    var tpl = Quote.getTemplate();
    if (!tpl) return toast('견적서 양식 파일을 먼저 올려 주세요. (서류 화면 맨 위)');
    var q = saveQuote(true); if (!q) return;
    var bytes;
    try { bytes = Quote.build(tpl, q); } catch (e) { return toast(e.message); }
    var blob = new Blob([bytes], { type: XLSX_TYPE });
    if (share) {
      var file = new File([blob], '견적서_' + q.clientName.replace(/[\\/:*?"<>|]/g, ' ') + '_' + q.date + '.xlsx', { type: XLSX_TYPE });
      return navigator.share({ files: [file], title: '견적서 - ' + q.clientName }).catch(function (e) { if (!e || e.name !== 'AbortError') toast('공유하지 못했습니다. "엑셀 파일로 받기"를 써 주세요.'); });
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'mimifresh-quote-' + q.date + '.xlsx'; // 한글 이름은 일부 브라우저에서 깨져 영문 사용
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('엑셀 파일을 만들었습니다. 다운로드(파일) 폴더를 확인하세요.');
  }
  function toggleQuoteSent() {
    var q = saveQuote(true); if (!q) return;
    q.sent = !q.sent; ui.sheet.draft.sent = q.sent; ui.sheet.original = JSON.stringify(ui.sheet.draft);
    var c = q.clientId && byId(q.clientId);
    if (q.sent && c && (c.status === '미방문' || c.status === '방문 완료')) c.status = '견적 발송';
    save(); renderSheet(); toast(q.sent ? '발송 완료로 표시했습니다.' + (c ? ' 거래처 상태도 "견적 발송"으로 바꿨습니다.' : '') : '발송 표시를 취소했습니다.');
  }
  function copyQuote() {
    var q = saveQuote(true); if (!q) return;
    var from = JSON.parse(JSON.stringify(q));
    openQuote(null, null, Object.assign(from, { id: Store.uid(), date: Store.todayStr(), sent: false }));
    toast('복사했습니다. 받는 곳과 금액을 고친 뒤 저장하세요.');
  }
  function deleteQuote() {
    var d = ui.sheet.draft;
    if (!confirm('"' + d.clientName + '" 견적서를 삭제할까요?')) return;
    db.quotes = db.quotes.filter(function (q) { return q.id !== d.id; });
    save(); closeSheet(true); toast('삭제했습니다.');
  }
  function loadTemplate(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try { Quote.setTemplate(new Uint8Array(fr.result)); toast('견적서 양식을 등록했습니다.'); syncTemplate(true); }
      catch (e) { toast(e.message); }
      if (ui.sheet) renderSheet(); else render();
    };
    fr.readAsArrayBuffer(file);
  }

  /* ================= 설정 ================= */
  function renderSettings() {
    var s = db.settings, st = KakaoApi.state, h = '';
    var kst = !s.kakaoKey ? '<div class="pos no">' + icon('pin', 18) + '키가 아직 없습니다</div>' :
      st.status === 'ready' ? '<div class="pos yes">' + icon('check', 18) + '카카오맵 연결됨</div>' :
        st.status === 'loading' ? '<div class="pos">연결 확인 중…</div>' : '<div class="pos no">' + esc(st.message || '연결 안 됨') + '</div>';
    h += '<div class="sec-h"><b>사무실</b></div><div class="group pad">' +
      (s.office ? '<div class="pos yes" style="margin-top:0">' + icon('home', 18) + esc(s.office.name) + '</div><p class="hint" style="margin:4px 0 10px 24px">' + esc(s.office.address) + '</p>' : '<div class="pos no" style="margin:0 0 10px">' + icon('pin', 18) + '아직 지정되지 않았습니다</div>') +
      '<div class="searchbar">' + icon('search', 20) + '<input id="s-office" type="search" placeholder="사무실 이름 또는 주소로 검색" data-suggest="office" autocomplete="off"></div><div id="sg-office" class="sg"></div>' +
      '<p class="hint">영업 동선의 출발점이자 도착점입니다. 검색해서 고르면 바로 바뀝니다.</p></div>';

    h += '<div class="sec-h"><b>카카오 연결</b></div><div class="group pad">' +
      '<label class="f" for="s-key" style="margin-top:0">JavaScript 키 (지도 · 검색)</label><input id="s-key" type="text" value="' + esc(s.kakaoKey) + '" placeholder="카카오 개발자 사이트의 JavaScript 키" autocomplete="off" autocapitalize="off" spellcheck="false">' + kst +
      '<label class="f" for="s-rest">REST API 키 (자동차 경로 · 선택)</label><input id="s-rest" type="text" value="' + esc(s.kakaoRestKey) + '" placeholder="자동차 경로용 (없어도 됩니다)" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button class="btn pri wide" style="margin-top:12px" data-act="save-key">키 저장</button>' +
      '<p class="hint">카카오 개발자 사이트에 등록할 주소: <b>' + esc(location.origin) + '</b></p></div>';

    var ds = driveStatus();
    h += '<div class="sec-h"><b>구글 드라이브 저장</b></div><div class="group pad">' +
      (CONFIG_GID ? '<p class="hint" style="margin-top:0">구글 로그인 정보가 앱에 들어 있습니다. 어느 기기에서든 로그인만 하면 됩니다.</p>' :
        '<label class="f" for="s-gid" style="margin-top:0">구글 클라이언트 ID</label><input id="s-gid" type="text" value="' + esc(s.googleClientId) + '" placeholder="○○○.apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<button class="btn wide" style="margin-top:8px" data-act="save-gid">클라이언트 ID 저장</button>' +
        (s.googleClientId ? '<button class="btn soft wide" style="margin-top:8px" data-act="copy-link">' + icon('copy', 18) + '다른 기기용 링크 복사</button>' : ''));
    if (s.googleClientId) {
      h += '<div class="pos ' + (ds.ok ? 'yes' : 'no') + '">' + icon('cloud', 18) + esc(ds.text) + '</div>';
      h += Drive.connected() ?
        '<div class="row2" style="margin-top:10px"><button class="btn pri" data-act="drive-save">지금 저장</button><button class="btn" data-act="drive-load">드라이브에서 가져오기</button></div>' :
        '<button class="btn pri wide" style="margin-top:10px" data-act="drive-connect">' + icon('cloud', 20) + 'Google로 로그인</button>';
    }
    h += '</div>';
    if (s.googleClientId) h += '<div class="group"><label class="switch"><span>바뀔 때마다 자동 저장<br><small class="hint" style="margin:0">연결돼 있는 동안 거래처를 고치면 바로 드라이브에 올립니다</small></span><input id="s-auto" type="checkbox"' + (s.driveAuto ? ' checked' : '') + '></label></div>';
    h += '<p class="hint">로그인하면 거래처 · 견적 · 카카오 키 · 사무실 · 견적서 양식이 내 구글 드라이브에 저장되고, 다른 기기에서도 로그인만 하면 그대로 따라옵니다. 로그인은 약 1시간 유지되며, 그 뒤에는 위쪽 구름 단추를 한 번 눌러 다시 로그인합니다.</p>';

    h += '<div class="sec-h"><b>파일 백업</b></div><div class="group pad"><div class="row2"><button class="btn" data-act="export">내보내기</button><button class="btn" data-act="import">불러오기</button></div>' +
      '<p class="hint" style="margin-bottom:0">거래처 ' + db.clients.length + '곳 · 방문 기록 ' + db.visits.length + '건. 드라이브를 쓰지 않을 때의 보관 방법입니다.</p></div>';

    var hasSample = db.clients.some(function (c) { return c.id.indexOf('sample-') === 0; });
    h += '<div class="sec-h"><b>기타</b></div><div class="group pad">' +
      (hasSample ? '<button class="btn wide" data-act="sample-remove">연습용 샘플 지우기</button>' : '<button class="btn wide" data-act="sample">연습용 샘플 5곳 넣기</button>') +
      '<button class="btn danger wide" style="margin-top:8px" data-act="wipe">모든 데이터 지우기</button></div>';
    $('#tab-settings').innerHTML = h;
  }
  function saveKeys() {
    var key = $('#s-key').value.trim(), rest = $('#s-rest').value.trim();
    var jsChanged = key !== db.settings.kakaoKey || (key && KakaoApi.state.status !== 'ready');
    db.settings.kakaoKey = key; db.settings.kakaoRestKey = rest;
    roadCache = {}; roadFail = {};
    save();
    if (jsChanged) return location.reload(); // 지도 프로그램은 키를 바꾸면 화면을 새로 열어야 적용됩니다
    toast('저장했습니다.'); renderSettings();
  }

  /* ---------- 구글 드라이브 ---------- */
  function driveStatus() {
    var s = db.settings;
    if (ui.driveBusy) return { ok: true, text: '드라이브에 저장하는 중…' };
    if (ui.driveError) return { ok: false, text: ui.driveError };
    if (!Drive.connected()) return { ok: false, text: '연결되지 않음 — 눌러서 연결' };
    if (ui.drivePaused) return { ok: false, text: '자동 저장 잠시 멈춤 (드라이브 내용과 다름)' };
    if (driveDirty()) return { ok: false, text: s.driveAuto ? '저장 대기 중' : '저장하지 않은 변경이 있음' };
    return { ok: true, text: '드라이브에 저장됨' + (s.driveSyncedAt ? ' · ' + new Date(s.driveSyncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') };
  }
  function driveDirty() { return db.updatedAt !== (db.settings.driveLocalAt || ''); }
  function driveRefreshUi() { renderHeader(); if (ui.tab === 'settings' && !ui.sheet && document.activeElement && document.activeElement.tagName !== 'INPUT') renderSettings(); }
  function scheduleDrive() {
    var s = db.settings;
    if (!s.googleClientId || !s.driveAuto || ui.drivePaused) return renderHeader();
    clearTimeout(driveTimer);
    driveTimer = setTimeout(function () { if (Drive.connected()) driveUpload(false); else renderHeader(); }, 2500);
    renderHeader();
  }
  function driveUpload(manual) {
    if (ui.driveBusy) { if (!manual) scheduleDrive(); return Promise.resolve(); }
    ui.driveBusy = true; ui.driveError = ''; driveRefreshUi();
    var localAt = db.updatedAt;
    return Drive.save(JSON.stringify(db)).then(function (f) {
      db.settings.driveSyncedAt = f.modifiedTime; db.settings.driveLocalAt = localAt;
      Store.save(db); ui.drivePaused = false;
      if (manual) toast('구글 드라이브에 저장했습니다.');
    }, function (e) {
      ui.driveError = e.message; if (manual) toast(e.message);
    }).then(function () {
      ui.driveBusy = false; driveRefreshUi();
      if (db.updatedAt !== localAt && !ui.driveError) scheduleDrive();
    });
  }
  function driveApply(text, f) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('드라이브의 저장 파일을 읽을 수 없습니다.'); }
    var next = Store.normalize(raw), cur = db.settings;
    ['kakaoKey', 'kakaoRestKey'].forEach(function (k) { if (!next.settings[k]) next.settings[k] = cur[k]; });
    next.settings.googleClientId = cur.googleClientId; next.settings.driveAuto = cur.driveAuto;
    next.settings.driveSyncedAt = f.modifiedTime; next.settings.driveLocalAt = next.updatedAt;
    var reload = next.settings.kakaoKey !== cur.kakaoKey;
    db = next; Store.save(db); ui.drivePaused = false; ui.driveError = '';
    roadCache = {}; roadFail = {};
    if (reload) {
      // 이 기기에서 카카오맵을 아직 안 켰으면 새로 열 필요 없이 바로 연결. 이미 다른 키로 켜져 있으면 양식까지 받은 뒤 새로 연다
      if (KakaoApi.state.status !== 'none') return syncTemplate().then(function () { location.reload(); });
      KakaoApi.naviPreload(db.settings.kakaoKey).catch(function () { });
      KakaoApi.load(db.settings.kakaoKey).then(function () { if (!ui.sheet) render(); }, function () { if (!ui.sheet) render(); });
    }
    render(); toast('내 드라이브의 내용으로 맞췄습니다. 거래처 ' + db.clients.length + '곳');
  }
  /** 연결 직후: 드라이브에 다른 저장본이 있으면 어느 쪽을 쓸지 묻는다 */
  function driveAfterConnect() {
    return Drive.find().then(function (f) {
      if (!f) return driveUpload(true);
      if (f.modifiedTime === db.settings.driveSyncedAt) { if (driveDirty()) return driveUpload(false); return; }
      return Drive.download(f.id).then(function (text) {
        var remote; try { remote = Store.normalize(JSON.parse(text)); } catch (e) { remote = null; }
        if (!remote) return driveUpload(true);
        var when = new Date(f.modifiedTime).toLocaleString('ko-KR');
        // 이 기기에 올리지 않은 변경이 없으면(처음 로그인 포함) 묻지 않고 드라이브 내용으로 맞춘다
        if ((!db.clients.length && !db.quotes.length) || !driveDirty()) return driveApply(text, f);
        if (confirm('구글 드라이브의 내용이 이 휴대폰과 다릅니다.\n\n· 드라이브: 거래처 ' + remote.clients.length + '곳 (' + when + ' 저장)\n· 이 휴대폰: 거래처 ' + db.clients.length + '곳\n\n[확인] 드라이브 내용을 가져옵니다 (이 휴대폰 내용은 바뀝니다)\n[취소] 가져오지 않습니다')) return driveApply(text, f);
        if (confirm('그러면 이 휴대폰의 내용으로 드라이브를 덮어쓸까요?\n\n[확인] 드라이브를 이 휴대폰 내용으로 바꿉니다\n[취소] 아무것도 바꾸지 않습니다 (자동 저장을 잠시 멈춥니다)')) return driveUpload(true);
        ui.drivePaused = true;
      });
    });
  }
  function driveConnect() {
    var cid = db.settings.googleClientId;
    if (!cid) return toast('설정에서 구글 클라이언트 ID를 먼저 넣어 주세요.');
    ui.driveError = '';
    Drive.connect(cid).then(driveAfterConnect).then(syncTemplate).then(function () { $('#login').hidden = true; }).catch(function (e) { ui.driveError = /한 번 더/.test(e.message) ? '' : e.message; toast(e.message); }).then(driveRefreshUi);
  }
  /** 견적서 양식도 드라이브에 함께 둔다 (이 기기에 없으면 받아 오고, 드라이브에 없으면 올림) */
  function syncTemplate(forceUpload) {
    if (!Drive.connected()) return Promise.resolve();
    return Drive.find(Drive.TEMPLATE_NAME).then(function (f) {
      if (Quote.hasTemplate() && (forceUpload === true || !f)) return Drive.saveFile(Drive.TEMPLATE_NAME, XLSX_TYPE, Quote.getTemplate());
      if (!Quote.hasTemplate() && f) return Drive.download(f.id, true).then(function (bytes) { Quote.setTemplate(bytes); if (ui.tab === 'docs' && !ui.sheet) render(); });
    }).catch(function () { /* 양식은 다음 로그인 때 다시 시도 */ });
  }
  function driveLoad() {
    Drive.find().then(function (f) {
      if (!f) return toast('드라이브에 저장된 파일이 아직 없습니다.');
      return Drive.download(f.id).then(function (text) {
        var remote = Store.normalize(JSON.parse(text));
        if (!confirm('드라이브의 내용(거래처 ' + remote.clients.length + '곳, ' + new Date(f.modifiedTime).toLocaleString('ko-KR') + ' 저장)을 가져옵니다.\n지금 이 휴대폰의 내용(거래처 ' + db.clients.length + '곳)은 바뀝니다. 계속할까요?')) return;
        driveApply(text, f);
      });
    }).catch(function (e) { toast(e.message); });
  }

  /* ---------- 파일 백업 · 샘플 ---------- */
  function exportBackup() {
    var data = Object.assign({ app: 'mimifresh', exportedAt: new Date().toISOString() }, db);
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'mimifresh-backup-' + Store.todayStr() + '.json'; // 한글 이름은 일부 브라우저에서 깨져 영문 사용
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('백업 파일을 내보냈습니다. 다운로드(파일) 폴더를 확인하세요.');
  }
  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var raw;
      try { raw = JSON.parse(fr.result); } catch (e) { return toast('백업 파일을 읽을 수 없습니다. 이 앱에서 내보낸 파일인지 확인해 주세요.'); }
      if (!raw || !Array.isArray(raw.clients)) return toast('이 앱의 백업 파일이 아닙니다.');
      var next = Store.normalize(raw);
      if (!confirm('백업 파일의 거래처 ' + next.clients.length + '곳, 방문 기록 ' + next.visits.length + '건으로 바꿉니다.\n지금 있는 데이터(거래처 ' + db.clients.length + '곳)는 지워집니다. 계속할까요?')) return;
      ['kakaoKey', 'kakaoRestKey', 'googleClientId'].forEach(function (k) { if (!next.settings[k]) next.settings[k] = db.settings[k]; });
      next.settings.driveSyncedAt = db.settings.driveSyncedAt; next.settings.driveLocalAt = '';
      next.updatedAt = new Date().toISOString();
      db = next; Store.save(db);
      location.reload();
    };
    fr.readAsText(file);
  }
  function addSample() {
    if (!db.settings.office) db.settings.office = Object.assign({}, Store.SAMPLE_OFFICE);
    Store.SAMPLE_CLIENTS.forEach(function (s, i) {
      if (byId(s.id)) return;
      var now = new Date(Date.now() + i).toISOString();
      db.clients.push(Object.assign({ address: '(연습용 가상 주소 ' + (i + 1) + ')', contactName: '', phone: '', memo: '연습용 샘플입니다.', status: '미방문', placeId: '', createdAt: now, updatedAt: now }, s));
    });
    save(); renderSettings(); toast('샘플 5곳을 넣었습니다. 영업 탭에서 "샘플"을 검색해 보세요.');
  }
  function removeSample() {
    var isS = function (id) { return String(id).indexOf('sample-') === 0; };
    db.clients = db.clients.filter(function (c) { return !isS(c.id); });
    db.visits = db.visits.filter(function (v) { return !isS(v.clientId); });
    db.today.stops = db.today.stops.filter(function (s) { return !isS(s.clientId); });
    db.today.recommended = null; if (!db.today.stops.length) db.today.planned = false;
    if (db.settings.office && db.settings.office.name === Store.SAMPLE_OFFICE.name) db.settings.office = null;
    save(); renderSettings(); toast('샘플을 지웠습니다.');
  }

  /* ================= 버튼 연결 ================= */
  var ACT = {
    'open': function (b) { openClient(b.dataset.id); },
    'new': function () { editClient(null); },
    'edit': function (b) { editClient(b.dataset.id); },
    'sort': function (b) { ui.sort = b.dataset.v; renderClients(); },
    'ftype': function (b) { ui.fType = b.dataset.v; renderClients(); },
    'copy': function (b) { copyText(b.dataset.v); },
    'sheet-close': function () { closeSheet(false); },
    'sheet-save': saveSheet,
    'sheet-delete': deleteClient,
    'search-addr': searchAddr,
    'pick-addr': function (b) { syncDraft(); applyAddr(ui.sheet.results[+b.dataset.i]); },
    'set-type': function (b) { syncDraft(); ui.sheet.draft.type = b.dataset.v; renderSheet(); },
    'set-status': function (b) { syncDraft(); ui.sheet.draft.status = b.dataset.v; renderSheet(); },
    'quick-status': function (b) { var c = byId(ui.sheet.id); c.status = b.dataset.v; c.updatedAt = new Date().toISOString(); save(); renderSheet(); },
    'add-visit': addVisit,
    'del-visit': function (b) {
      if (!confirm('이 방문 기록을 삭제할까요?')) return;
      db.visits = db.visits.filter(function (v) { return v.id !== b.dataset.id; }); save(); renderSheet();
    },
    'add-today': function (b) {
      var c = byId(b.dataset.id), ex = db.today.stops.find(function (s) { return s.clientId === c.id; });
      if (ex) { db.today.stops = db.today.stops.filter(function (s) { return s !== ex; }); db.today.recommended = null; if (!db.today.stops.length) db.today.planned = false; save(); toast('오늘 영업 목록에서 뺐습니다.'); }
      else addStop({ clientId: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone });
      renderSheet();
    },
    'sg-pick': function (b) { pickSuggestion(+b.dataset.i); },
    'navi': function (b) {
      var s = stopById(b.dataset.id), key = db.settings.kakaoKey;
      if (!key) return toast('카카오내비는 설정에 카카오 JavaScript 키를 넣어야 쓸 수 있습니다.');
      try { if (!KakaoApi.naviStart(key, s)) toast('카카오내비를 준비하고 있습니다. 잠시 뒤 한 번 더 눌러 주세요.'); }
      catch (e) { toast('카카오내비를 열지 못했습니다. 카카오맵 단추를 써 주세요.'); }
    },
    'quote-new': function (b) { var c = b.dataset.id ? byId(b.dataset.id) : null; openQuote(null, c); },
    'quote-open': function (b) { openQuote(b.dataset.id); },
    'quote-save': function () { saveQuote(); },
    'quote-export': function () { exportQuote(false); },
    'quote-share': function () { exportQuote(true); },
    'quote-copy': copyQuote,
    'quote-delete': deleteQuote,
    'quote-sent': toggleQuoteSent,
    'quote-add-item': function () { syncQuote(); var d = ui.sheet.draft; if (d.items.length < Quote.MAX_ITEMS) d.items.push(blankItem()); renderSheet(); },
    'quote-del-item': function (b) { syncQuote(); var d = ui.sheet.draft; d.items.splice(+b.dataset.i, 1); if (!d.items.length) d.items.push(blankItem()); renderSheet(); },
    'quote-vat': function (b) { syncQuote(); ui.sheet.draft.vat = b.dataset.v; renderSheet(); },
    'tpl-pick': function () { $('#tpl-file').value = ''; $('#tpl-file').click(); },
    'plan': plan,
    'reset-today': resetToday,
    'restore-rec': function () {
      var t = db.today; t.stops = t.recommended.map(stopById); save(); renderSalesBody();
    },
    'up': function (b) { moveStop(b.dataset.id, -1); },
    'down': function (b) { moveStop(b.dataset.id, 1); },
    'remove-stop': function (b) { removeStop(b.dataset.id); },
    'visit-toggle': function (b) { toggleVisit(b.dataset.id); },
    'register-stop': function (b) {
      var s = stopById(b.dataset.id);
      editClient(null, { name: s.name, address: s.address, lat: s.lat, lng: s.lng, phone: s.phone, type: guessType(s.name) }, s.id);
    },
    'go-settings': function () { switchTab('settings'); },
    'save-key': saveKeys,
    'save-gid': function () {
      db.settings.googleClientId = $('#s-gid').value.trim(); Drive.disconnect(); ui.driveError = ''; save();
      if (db.settings.googleClientId) Drive.preload(db.settings.googleClientId).catch(function (e) { ui.driveError = e.message; }).then(driveRefreshUi);
      renderHeader(); renderSettings(); toast('저장했습니다.');
    },
    'drive-connect': driveConnect,
    'login': driveConnect,
    'login-skip': function () { try { localStorage.setItem('mimifresh.skipLogin', '1'); } catch (e) { /* 무시 */ } $('#login').hidden = true; },
    'copy-link': function () { copyText(location.origin + location.pathname + '#gid=' + encodeURIComponent(db.settings.googleClientId), '기기 추가 링크를'); },
    'drive-tap': function () { if (Drive.connected() && !ui.driveError) { if (driveDirty() && !ui.drivePaused) driveUpload(true); else toast(driveStatus().text); } else driveConnect(); },
    'drive-save': function () { driveUpload(true); },
    'drive-load': driveLoad,
    'export': exportBackup,
    'import': function () { $('#import-file').value = ''; $('#import-file').click(); },
    'sample': addSample,
    'sample-remove': removeSample,
    'wipe': function () {
      if (!confirm('이 휴대폰의 거래처, 방문 기록, 설정을 모두 지웁니다.\n되돌릴 수 없습니다. 먼저 백업하셨나요?')) return;
      if (!confirm('정말로 모두 지울까요?')) return;
      db = Store.empty(); Store.save(db); location.reload();
    }
  };
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('#nav button');
    if (nav) return switchTab(nav.dataset.tab);
    var off = e.target.closest('a.off');
    if (off) return e.preventDefault();
    var b = e.target.closest('[data-act]');
    if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || !e.target.dataset) return;
    if (e.target.dataset.enter) { e.preventDefault(); ACT[e.target.dataset.enter](e.target); }
    else if (e.target.dataset.suggest && e.target.dataset.suggest !== 'client' && e.target.dataset.suggest !== 'quote') { e.preventDefault(); if (ui.sg && ui.sg.items && ui.sg.items.length) pickSuggestion(0); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { ui.q = e.target.value; renderClientList(); }
    else if (e.target.dataset && e.target.dataset.suggest) { if (e.target.id === 'qf-client' && ui.sheet) ui.sheet.draft.clientId = ''; onSuggestInput(e.target); }
    else if (e.target.dataset && e.target.dataset.k && ui.sheet && ui.sheet.mode === 'quote') { syncQuote(); var tt = $('#q-total'); if (tt) tt.textContent = won(Quote.total(ui.sheet.draft)); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'f-status') { ui.fStatus = e.target.value; renderClients(); }
    else if (e.target.id === 's-auto') { db.settings.driveAuto = e.target.checked; save(); }
    else if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
    else if (e.target.id === 'tpl-file' && e.target.files[0]) loadTemplate(e.target.files[0]);
    else if (e.target.dataset && e.target.dataset.k === 'service') { syncQuote(); renderSheet(); }
  });

  /* ================= 시작 ================= */
  initDrag();
  switchTab('clients');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  if (db.settings.kakaoKey) KakaoApi.naviPreload(db.settings.kakaoKey).catch(function () { });
  if (db.settings.kakaoKey) {
    KakaoApi.load(db.settings.kakaoKey).then(function () { if (!ui.sheet && ui.tab !== 'clients') render(); }, function () { if (ui.tab === 'settings') render(); });
  }
  // 처음 여는 기기(내용이 비어 있음)면 로그인 화면부터 보여 준다
  (function () {
    var skipped = false; try { skipped = !!localStorage.getItem('mimifresh.skipLogin'); } catch (e) { /* 무시 */ }
    if (db.settings.googleClientId && !skipped && !db.clients.length && !db.quotes.length && !db.settings.kakaoKey) $('#login').hidden = false;
  })();
  if (db.settings.googleClientId) Drive.preload(db.settings.googleClientId).catch(function (e) { ui.driveError = e.message; renderHeader(); });
})();
