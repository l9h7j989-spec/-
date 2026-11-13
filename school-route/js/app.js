/*
 * app.js — 화면 동작 (거래처 목록 / 오늘 동선 / 설정)
 * 계산은 route.js, 저장은 store.js, 카카오 연결은 kakao.js 가 맡습니다.
 */
(function () {
  'use strict';
  var TYPES = Store.TYPES, STATUSES = Store.STATUSES;
  var TYPE_SHORT = { '초등학교': '초', '중학교': '중', '고등학교': '고', '기관': '기관' };
  var TITLES = { clients: '거래처 (사무실에서 가까운 순)', route: '오늘의 동선', settings: '설정' };

  var db = Store.load();
  var ui = { tab: 'clients', q: '', fType: '전체', fStatus: '전체', draft: null, original: '', isNew: false, results: null, resultsKind: '', officeResults: null };
  var map = null, overlays = [], line = null, routeSeq = 0, toastTimer = null;

  /* ---------- 작은 도구들 ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtKm(km) { return km.toFixed(1) + 'km'; }
  function hasPos(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function byId(id) { return db.clients.find(function (c) { return c.id === id; }); }
  function visitsOf(id) { return db.visits.filter(function (v) { return v.clientId === id; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); }); }
  function visitedToday(id) { var d = Store.todayStr(); return db.visits.some(function (v) { return v.clientId === id && v.date === d; }); }
  function telHref(p) { return 'tel:' + String(p).replace(/[^0-9+*#]/g, ''); }
  function save() { if (!Store.save(db)) toast('저장에 실패했습니다. 휴대폰 저장 공간이나 브라우저의 사생활 보호 모드를 확인해 주세요.'); updateNavCount(); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function updateNavCount() {
    var n = db.today.selected.length, b = $('#nav-count');
    b.hidden = !n; b.textContent = n;
  }
  function guessType(name) {
    if (/초등학교|초교/.test(name)) return '초등학교';
    if (/중학교/.test(name)) return '중학교';
    if (/고등학교|고교/.test(name)) return '고등학교';
    return '기관';
  }

  /* ---------- 탭 ---------- */
  function switchTab(tab) {
    ui.tab = tab;
    ['clients', 'route', 'settings'].forEach(function (t) { $('#tab-' + t).hidden = t !== tab; });
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    $('#title').textContent = TITLES[tab];
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    updateNavCount();
    if (ui.tab === 'clients') renderClients();
    else if (ui.tab === 'route') renderRoute();
    else renderSettings();
  }

  /* ================= 거래처 목록 (기능 2·3) ================= */
  function chipRow(label, act, values, cur) {
    return '<div class="chips-label">' + label + '</div><div class="chips">' + values.map(function (v) {
      return '<button class="chip' + (v === cur ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(v) + '">' + esc(v) + '</button>';
    }).join('') + '</div>';
  }
  function renderClients() {
    var office = db.settings.office, html = '';
    if (!office) html += '<div class="notice">사무실 위치가 아직 없습니다. <b>설정</b>에서 사무실을 지정하면 가까운 순서로 정렬되고 거리가 표시됩니다.</div>';
    html += '<input id="q" type="search" placeholder="🔍 거래처 이름 검색" value="' + esc(ui.q) + '" autocomplete="off">';
    html += chipRow('구분', 'ftype', ['전체'].concat(TYPES), ui.fType);
    html += chipRow('영업 상태', 'fstatus', ['전체'].concat(STATUSES), ui.fStatus);
    html += '<div class="todaybar"><span id="today-count"></span><button class="btn small danger fit" data-act="reset-today">오늘 목록 초기화</button></div>';
    html += '<div id="client-list"></div>';
    html += '<button class="fab" data-act="new">＋ 거래처 추가</button>';
    $('#tab-clients').innerHTML = html;
    renderClientList();
  }
  function renderClientList() {
    var office = db.settings.office, q = ui.q.trim().toLowerCase();
    var rows = db.clients.map(function (c) {
      return { c: c, km: office && hasPos(c) ? Route.haversineKm(office, c) : null };
    }).filter(function (r) {
      return (ui.fType === '전체' || r.c.type === ui.fType) &&
        (ui.fStatus === '전체' || r.c.status === ui.fStatus) &&
        (!q || r.c.name.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) {
      if (a.km == null && b.km == null) return a.c.name.localeCompare(b.c.name, 'ko');
      if (a.km == null) return 1;
      if (b.km == null) return -1;
      return a.km - b.km;
    });
    $('#today-count').textContent = '오늘 방문 ' + db.today.selected.length + '곳 선택';
    var el = $('#client-list');
    if (!db.clients.length) { el.innerHTML = '<div class="empty">등록된 거래처가 없습니다.<br>아래 <b>＋ 거래처 추가</b>를 눌러 시작하세요.<br><br>먼저 연습해 보려면 설정 → <b>샘플 넣기</b></div>'; return; }
    if (!rows.length) { el.innerHTML = '<div class="empty">조건에 맞는 거래처가 없습니다.</div>'; return; }
    el.innerHTML = rows.map(function (r) {
      var c = r.c, on = db.today.selected.indexOf(c.id) >= 0;
      var km = r.km != null ? '<span class="km">' + fmtKm(r.km) + '</span>' : (hasPos(c) ? '' : '<span class="km none">위치 없음</span>');
      return '<div class="card client">' +
        '<button class="check' + (on ? ' on' : '') + '" data-act="toggle" data-id="' + c.id + '" aria-pressed="' + on + '" aria-label="오늘 방문에 ' + (on ? '포함됨' : '넣기') + '">✓</button>' +
        '<button class="body" data-act="open" data-id="' + c.id + '">' +
        '<div class="r1"><span class="name">' + esc(c.name) + '</span>' + km + '</div>' +
        '<div class="r2"><span class="badge type">' + TYPE_SHORT[c.type] + '</span><span class="badge st-' + STATUSES.indexOf(c.status) + '">' + c.status + '</span></div>' +
        '<div class="addr">' + esc(c.address) + '</div></button>' +
        (c.phone ? '<a class="call" href="' + telHref(c.phone) + '" aria-label="' + esc(c.name) + ' 전화 걸기">📞</a>' : '') +
        '</div>';
    }).join('');
  }
  function toggleToday(id) {
    var c = byId(id), t = db.today, i = t.selected.indexOf(id);
    if (i >= 0) t.selected.splice(i, 1);
    else {
      if (!hasPos(c)) return toast('위치(좌표)가 없는 거래처입니다. 거래처를 열어 위치를 먼저 찾아 주세요.');
      if (!t.selected.length) t.date = Store.todayStr();
      t.selected.push(id);
    }
    save();
  }
  function resetToday() {
    if (!db.today.selected.length) return toast('선택된 방문지가 없습니다.');
    if (!confirm('오늘 방문 목록을 모두 비울까요?\n(거래처와 방문 기록은 지워지지 않습니다)')) return;
    db.today = Store.empty().today;
    save(); render();
  }

  /* ================= 거래처 입력창 (기능 2·5) ================= */
  function openSheet(id) {
    var c = id ? byId(id) : null;
    ui.isNew = !c;
    ui.draft = c ? JSON.parse(JSON.stringify(c)) : { id: Store.uid(), name: '', type: '초등학교', address: '', lat: null, lng: null, contactName: '', phone: '', memo: '', status: '미방문', placeId: '' };
    ui.original = JSON.stringify(ui.draft);
    ui.results = null;
    renderSheet();
    $('#sheet').hidden = false; $('#sheet').scrollTop = 0;
  }
  function syncDraft() {
    var d = ui.draft; if (!d || !$('#f-name')) return;
    d.name = $('#f-name').value.trim();
    var addr = $('#f-address').value.trim();
    if (addr !== d.address) { d.address = addr; }
    d.contactName = $('#f-contact').value.trim();
    d.phone = $('#f-phone').value.trim();
    d.memo = $('#f-memo').value;
  }
  function seg(act, values, cur) {
    return '<div class="seg">' + values.map(function (v) { return '<button type="button" class="' + (v === cur ? 'on' : '') + '" data-act="' + act + '" data-v="' + esc(v) + '">' + esc(v) + '</button>'; }).join('') + '</div>';
  }
  function resultsHtml(list, act) {
    if (!list) return '';
    if (!list.length) return '<div class="notice" style="margin-top:8px">검색 결과가 없습니다. 이름을 조금 바꾸거나, 주소를 직접 입력한 뒤 <b>주소로 위치 찾기</b>를 눌러 주세요.</div>';
    return '<p class="hint">' + list.length + '건 — 맞는 곳을 눌러 고르세요.</p><div class="results">' + list.map(function (r, i) {
      return '<button type="button" data-act="' + act + '" data-i="' + i + '"><b>' + esc(r.name) + '</b><small>' + esc(r.address) + '</small></button>';
    }).join('') + '</div>';
  }
  function renderSheet() {
    var d = ui.draft, h = '';
    h += '<div class="bar"><button data-act="sheet-close">← 닫기</button><h2>' + (ui.isNew ? '거래처 추가' : '거래처 정보') + '</h2><button data-act="sheet-save">저장</button></div><div class="in">';
    h += '<div class="card">';
    h += '<label class="f" for="f-name">이름</label><div class="row"><input id="f-name" type="text" value="' + esc(d.name) + '" placeholder="예: ○○초등학교" data-enter="search-name" autocomplete="off"><button class="btn pri fit" data-act="search-name">검색</button></div>';
    h += '<p class="hint">이름을 넣고 <b>검색</b>을 누르면 주소와 위치가 자동으로 채워집니다.</p>';
    if (ui.resultsKind === 'place') h += resultsHtml(ui.results, 'pick');
    h += '<label class="f" for="f-address">주소</label><input id="f-address" type="text" value="' + esc(d.address) + '" placeholder="검색이 안 되면 주소를 직접 입력" data-enter="search-addr" autocomplete="off">';
    h += '<button class="btn wide small" style="margin-top:8px" data-act="search-addr">주소로 위치 찾기</button>';
    if (ui.resultsKind === 'addr') h += resultsHtml(ui.results, 'pick');
    h += hasPos(d) ? '<div class="pos yes">📍 위치 확인됨</div>' : '<div class="pos no">📍 위치 없음 — 거리·동선 계산에 쓰려면 위치가 필요합니다</div>';
    h += '<label class="f">구분</label>' + seg('set-type', TYPES, d.type);
    h += '<label class="f" for="f-contact">담당자 이름</label><input id="f-contact" type="text" value="' + esc(d.contactName) + '" autocomplete="off">';
    h += '<label class="f" for="f-phone">연락처</label><div class="row"><input id="f-phone" type="tel" value="' + esc(d.phone) + '" placeholder="010-0000-0000" autocomplete="off">' +
      (d.phone ? '<a class="btn ok fit" href="' + telHref(d.phone) + '">📞 전화</a>' : '') + '</div>';
    h += '<label class="f">영업 상태</label>' + seg('set-status', STATUSES, d.status);
    h += '<label class="f" for="f-memo">메모</label><textarea id="f-memo">' + esc(d.memo) + '</textarea>';
    h += '<button class="btn pri wide big" style="margin-top:14px" data-act="sheet-save">저장</button>';
    h += '</div>';
    if (!ui.isNew) {
      var vs = visitsOf(d.id);
      h += '<div class="card"><h2>방문 기록 (' + vs.length + '건)</h2>';
      h += '<div class="row"><input id="v-date" type="date" value="' + Store.todayStr() + '"></div><textarea id="v-memo" placeholder="방문 메모 (예: 행정실장 면담, 견적 요청 받음)" style="margin-top:8px"></textarea>';
      h += '<button class="btn wide" style="margin-top:8px" data-act="add-visit">＋ 방문 기록 추가</button>';
      h += vs.length ? vs.map(function (v) {
        return '<div class="visit"><span class="d">' + v.date + '</span><span class="m">' + (esc(v.memo) || '(메모 없음)') + '</span><button data-act="del-visit" data-id="' + v.id + '" aria-label="기록 삭제">삭제</button></div>';
      }).join('') : '<p class="hint">아직 방문 기록이 없습니다.</p>';
      h += '</div>';
      h += '<button class="btn danger wide" data-act="sheet-delete">이 거래처 삭제</button>';
    }
    h += '</div>';
    $('#sheet').innerHTML = h;
  }
  function closeSheet(force) {
    syncDraft();
    if (!force && JSON.stringify(ui.draft) !== ui.original && !confirm('저장하지 않은 내용이 있습니다. 그냥 닫을까요?')) return;
    ui.draft = null; ui.results = null;
    $('#sheet').hidden = true; $('#sheet').innerHTML = '';
    render();
  }
  function saveSheet() {
    syncDraft();
    var d = ui.draft;
    if (!d.name) return toast('이름을 입력해 주세요.');
    if (!hasPos(d) && !confirm('위치(좌표)가 없습니다.\n이대로 저장하면 거리 표시와 동선 계산에서 빠집니다.\n그래도 저장할까요?')) return;
    d.updatedAt = new Date().toISOString();
    if (ui.isNew) { d.createdAt = d.updatedAt; db.clients.push(d); }
    else db.clients[db.clients.findIndex(function (c) { return c.id === d.id; })] = d;
    if (!hasPos(d)) db.today.selected = db.today.selected.filter(function (x) { return x !== d.id; });
    save(); toast('저장했습니다.');
    closeSheet(true);
  }
  function deleteClient() {
    var d = ui.draft;
    if (!confirm('"' + d.name + '" 거래처를 삭제할까요?\n방문 기록도 함께 지워집니다.')) return;
    db.clients = db.clients.filter(function (c) { return c.id !== d.id; });
    db.visits = db.visits.filter(function (v) { return v.clientId !== d.id; });
    db.quotes = db.quotes.filter(function (q) { return q.clientId !== d.id; });
    db.today.selected = db.today.selected.filter(function (x) { return x !== d.id; });
    save(); toast('삭제했습니다.');
    closeSheet(true);
  }
  function searchName() {
    syncDraft();
    if (!ui.draft.name) return toast('이름을 먼저 입력해 주세요.');
    toast('검색 중…');
    KakaoApi.searchPlaces(ui.draft.name).then(function (list) {
      if (!ui.draft) return;
      syncDraft(); ui.results = list; ui.resultsKind = 'place'; renderSheet();
    }).catch(function (e) { toast(e.message); });
  }
  function searchAddr() {
    syncDraft();
    if (!ui.draft.address) return toast('주소를 먼저 입력해 주세요.');
    toast('주소 찾는 중…');
    KakaoApi.geocode(ui.draft.address).then(function (list) {
      if (!ui.draft) return;
      syncDraft();
      if (list.length === 1) { applyResult(list[0], 'addr'); toast('위치를 찾았습니다.'); return; }
      ui.results = list; ui.resultsKind = 'addr'; renderSheet();
    }).catch(function (e) { toast(e.message); });
  }
  function applyResult(r, kind) {
    var d = ui.draft;
    d.address = r.address; d.lat = r.lat; d.lng = r.lng;
    if (kind === 'place') {
      d.name = r.name; d.placeId = r.placeId;
      if (!d.phone && r.phone) d.phone = r.phone;
      if (ui.isNew) d.type = guessType(r.name);
    }
    ui.results = null; renderSheet();
  }
  function addVisit() {
    var d = ui.draft, date = $('#v-date').value, memo = $('#v-memo').value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('방문 날짜를 골라 주세요.');
    syncDraft();
    db.visits.push({ id: Store.uid(), clientId: d.id, date: date, memo: memo, createdAt: new Date().toISOString() });
    var c = byId(d.id);
    if (c.status === '미방문') { c.status = '방문 완료'; if (d.status === '미방문') d.status = '방문 완료'; ui.original = JSON.stringify(Object.assign(JSON.parse(ui.original), { status: '방문 완료' })); }
    save(); renderSheet(); toast('방문 기록을 추가했습니다.');
  }

  /* ================= 오늘의 동선 (기능 4·5) ================= */
  /** 선택이 바뀌었으면 순서 목록을 맞춘다. 반환값: 화면에 쓸 방문지 id 순서 */
  function syncOrder() {
    var t = db.today;
    t.selected = t.selected.filter(function (id) { return hasPos(byId(id)); });
    if (!t.order) return;
    var kept = t.order.filter(function (id) { return t.selected.indexOf(id) >= 0; });
    var added = t.selected.filter(function (id) { return kept.indexOf(id) < 0; });
    if (kept.length !== t.order.length || added.length) {
      t.order = kept.concat(added); t.recommended = null; t.recommendedKm = null; t.method = null;
    }
    if (!t.order.length) t.order = null;
    Store.save(db);
  }
  function fullRouteLink(office, stops) {
    var seg = function (p) { return encodeURIComponent(String(p.name).replace(/[,\/]/g, ' ')) + ',' + p.lat + ',' + p.lng; };
    return 'https://map.kakao.com/link/by/car/' + [office].concat(stops, [office]).map(seg).join('/');
  }
  function renderRoute() {
    var my = ++routeSeq;
    syncOrder();
    var t = db.today, office = db.settings.office;
    var head = $('#route-head'), body = $('#route-body'), wrap = $('#map-wrap');
    if (!office) {
      wrap.hidden = true; body.innerHTML = '';
      head.innerHTML = '<div class="notice">동선은 사무실에서 출발해 사무실로 돌아옵니다. 먼저 사무실 위치를 지정해 주세요.</div><button class="btn pri wide big" data-act="go-settings">설정으로 가기</button>';
      return;
    }
    if (!t.selected.length) {
      wrap.hidden = true; body.innerHTML = '';
      head.innerHTML = '<div class="empty">오늘 방문할 곳이 없습니다.<br><b>거래처</b> 탭에서 방문할 곳의 왼쪽 <b>✓ 칸</b>을 눌러 고르세요.</div><button class="btn pri wide big" data-act="go-clients">거래처 고르러 가기</button>';
      return;
    }
    var stops = (t.order || t.selected).map(byId);
    var old = t.date !== Store.todayStr() ? '<div class="notice">이 목록은 <b>' + t.date + '</b>에 만든 것입니다. 오늘 새로 짜려면 아래 <b>오늘 목록 초기화</b>를 누르세요.</div>' : '';

    if (!t.order) {
      wrap.hidden = true;
      head.innerHTML = old + '<div class="card total">오늘 방문 <b>' + stops.length + '곳</b> 선택됨</div>' +
        '<button class="btn pri wide big" data-act="recommend">🧭 동선 추천</button>' +
        '<button class="btn danger wide" style="margin-top:8px" data-act="reset-today">오늘 목록 초기화</button>';
      body.innerHTML = '<div class="card" style="margin-top:10px">' + stops.map(function (c) {
        return '<div class="visit"><span class="m" style="color:inherit"><b>' + esc(c.name) + '</b></span><button data-act="remove-stop" data-id="' + c.id + '">빼기</button></div>';
      }).join('') + '</div>';
      return;
    }

    Route.buildMatrix([office].concat(stops)).then(function (m) {
      if (my !== routeSeq) return;
      var idx = stops.map(function (_, i) { return i + 1; });
      var legs = Route.legs(m, idx), total = Route.tourLength(m, idx);
      var done = stops.filter(function (c) { return visitedToday(c.id); }).length;
      var h = old + '<div class="card total"><div>총 이동 거리 (사무실 출발 → 사무실 도착)</div><div class="num">' + fmtKm(total) + '</div>';
      if (!t.recommended) h += '<div class="notice" style="margin:8px 0 0">방문지가 바뀌었습니다. <b>동선 다시 추천</b>을 눌러 순서를 새로 계산하세요.</div>';
      else if (t.recommended.join() === t.order.join()) h += '<div class="hint">' + (t.method === 'exact' ? '✅ 모든 순서를 따져 구한 <b>가장 짧은 순서</b>입니다.' : '⚡ 방문지가 ' + Route.EXACT_LIMIT + '곳을 넘어 <b>근사 계산</b>(최근접 이웃 + 2-opt)한 순서입니다. 가장 짧은 순서와 조금 다를 수 있습니다.') + '</div>';
      else h += '<div class="hint">직접 바꾼 순서입니다. 추천 순서(' + fmtKm(t.recommendedKm) + ')보다 <b>' + (total - t.recommendedKm >= 0 ? '+' : '') + fmtKm(total - t.recommendedKm) + '</b></div><button class="btn small wide" data-act="restore-rec">추천 순서로 되돌리기</button>';
      h += '<div class="hint">직선거리 기준이라 실제 도로 거리는 이보다 깁니다. · 방문 완료 ' + done + '/' + stops.length + '</div></div>';
      h += '<div class="row"><button class="btn pri" data-act="recommend">🧭 동선 다시 추천</button><button class="btn danger" data-act="reset-today">오늘 목록 초기화</button></div>';
      if (stops.length <= 5) h += '<a class="btn wide" style="margin-top:8px" target="_blank" rel="noopener" href="' + fullRouteLink(office, stops) + '">🗺 전체 경로를 카카오맵에서 보기</a>';
      head.innerHTML = h + '<div style="height:10px"></div>';

      var b = '<div class="depot"><span class="mk office">출발</span>' + esc(office.name || '사무실') + '</div><div id="stops">';
      stops.forEach(function (c, i) {
        var dn = visitedToday(c.id);
        b += '<div class="card stop' + (dn ? ' done' : '') + '" data-id="' + c.id + '">' +
          '<div class="leg">앞 지점에서 <b>' + fmtKm(legs[i]) + '</b></div>' +
          '<div class="top"><button class="handle" aria-label="끌어서 순서 바꾸기">≡</button><span class="no">' + (i + 1) + '</span>' +
          '<span class="nm">' + esc(c.name) + '<small>' + esc(c.address) + '</small></span>' +
          '<span class="mv"><button data-act="up" data-id="' + c.id + '" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>▲</button><button data-act="down" data-id="' + c.id + '" aria-label="아래로"' + (i === stops.length - 1 ? ' disabled' : '') + '>▼</button></span></div>' +
          '<div class="acts"><a class="btn small" target="_blank" rel="noopener" href="' + KakaoApi.navLink(c) + '">🚗 카카오맵 길안내</a>' +
          (c.phone ? '<a class="btn small" href="' + telHref(c.phone) + '">📞 전화</a>' : '<button class="btn small" data-act="open" data-id="' + c.id + '">ℹ️ 정보</button>') +
          '<button class="btn small ' + (dn ? '' : 'ok') + '" data-act="visit-toggle" data-id="' + c.id + '">' + (dn ? '✓ 방문 완료됨 (취소)' : '방문 완료') + '</button>' +
          '<button class="btn small" data-act="remove-stop" data-id="' + c.id + '">오늘 목록에서 빼기</button></div></div>';
      });
      b += '</div><div class="depot"><span class="mk office">도착</span>' + esc(office.name || '사무실') + ' <span class="leg" style="padding:0">마지막 구간 <b>' + fmtKm(legs[legs.length - 1]) + '</b></span></div>';
      b += '<p class="hint">순서 바꾸기: 왼쪽 <b>≡</b>를 누른 채 위아래로 끌거나 ▲▼를 누르세요. 총 거리가 바로 다시 계산됩니다.</p>';
      body.innerHTML = b;
      drawMap(office, stops);
    });
  }
  function recommend() {
    var t = db.today, office = db.settings.office;
    var stops = t.selected.map(byId);
    Route.buildMatrix([office].concat(stops)).then(function (m) {
      var r = Route.solve(m);
      t.order = r.order.map(function (i) { return stops[i - 1].id; });
      t.recommended = t.order.slice(); t.recommendedKm = r.km; t.method = r.method; t.date = Store.todayStr();
      save(); renderRoute();
      toast('동선을 계산했습니다. 총 ' + fmtKm(r.km));
    });
  }
  function moveStop(id, delta) {
    var o = db.today.order, i = o.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= o.length) return;
    o.splice(j, 0, o.splice(i, 1)[0]);
    save(); renderRoute();
  }
  function toggleVisitToday(id) {
    var c = byId(id), d = Store.todayStr();
    if (visitedToday(id)) {
      if (!confirm('"' + c.name + '"의 오늘 방문 기록을 취소할까요?')) return;
      db.visits = db.visits.filter(function (v) { return !(v.clientId === id && v.date === d); });
      if (c.status === '방문 완료' && !visitsOf(id).length) c.status = '미방문';
    } else {
      db.visits.push({ id: Store.uid(), clientId: id, date: d, memo: '', createdAt: new Date().toISOString() });
      if (c.status === '미방문') c.status = '방문 완료';
      toast(c.name + ' — 오늘(' + d + ') 방문 기록을 남겼습니다.');
    }
    save(); renderRoute();
  }
  function drawMap(office, stops) {
    var wrap = $('#map-wrap'), el = $('#map'), msg = $('#map-msg');
    wrap.hidden = false;
    if (KakaoApi.state.status !== 'ready') {
      el.hidden = true;
      msg.textContent = KakaoApi.state.status === 'loading' ? '지도를 불러오는 중…' : (KakaoApi.state.message || '설정에서 카카오 키를 입력하면 여기에 지도가 나옵니다. (순서와 거리는 지도 없이도 계산됩니다)');
      return;
    }
    el.hidden = false;
    msg.textContent = '주황색은 사무실, 번호는 방문 순서입니다. 선은 직선으로 이은 것이라 실제 도로와 다릅니다.';
    var K = kakao.maps;
    if (!map) map = new K.Map(el, { center: new K.LatLng(office.lat, office.lng), level: 6 });
    map.relayout();
    overlays.forEach(function (o) { o.setMap(null); }); overlays = [];
    if (line) line.setMap(null);
    var bounds = new K.LatLngBounds(), path = [];
    var add = function (p, html) {
      var pos = new K.LatLng(p.lat, p.lng);
      bounds.extend(pos); path.push(pos);
      overlays.push(new K.CustomOverlay({ map: map, position: pos, content: html, xAnchor: 0.5, yAnchor: 0.5 }));
    };
    add(office, '<div class="mk office">사</div>');
    stops.forEach(function (c, i) { add(c, '<div class="mk' + (visitedToday(c.id) ? ' done' : '') + '">' + (i + 1) + '</div>'); });
    path.push(path[0]);
    line = new K.Polyline({ map: map, path: path, strokeWeight: 4, strokeColor: '#1d4ed8', strokeOpacity: 0.85, strokeStyle: 'solid' });
    map.setBounds(bounds);
  }

  /* 손으로 끌어서 순서 바꾸기 */
  function initDrag() {
    var body = $('#route-body'), drag = null;
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
      // 옆 칸과 자리를 바꾸면 내 칸이 움직이는 거리(칸 높이 + 간격)의 절반을 넘었을 때만 바꾼다
      var upBy = prev ? it.offsetTop - prev.offsetTop : 0;
      var downBy = next ? (next.offsetTop + next.offsetHeight) - (it.offsetTop + it.offsetHeight) : 0;
      if (prev && dy < -upBy / 2) {
        before = it.offsetTop; drag.list.insertBefore(it, prev); drag.startY -= before - it.offsetTop;
      } else if (next && dy > downBy / 2) {
        before = it.offsetTop; drag.list.insertBefore(next, it); drag.startY += it.offsetTop - before;
      }
      it.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
      var edge = 70, step = 0;
      if (e.clientY < edge + 50) step = -14; else if (e.clientY > window.innerHeight - edge - 70) step = 14;
      if (step) { var y0 = window.scrollY; window.scrollBy(0, step); drag.startY -= window.scrollY - y0; }
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var ids = Array.prototype.map.call(drag.list.querySelectorAll('.stop'), function (n) { return n.dataset.id; });
      drag = null;
      if (ids.join() !== db.today.order.join()) { db.today.order = ids; save(); }
      renderRoute();
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
  }

  /* ================= 설정 (기능 1) + 백업 ================= */
  function renderSettings() {
    var s = db.settings, st = KakaoApi.state, h = '';
    var stText = !s.kakaoKey ? '<span class="pos no">키가 아직 없습니다</span>' :
      st.status === 'ready' ? '<span class="pos yes">✅ 카카오맵 연결됨</span>' :
        st.status === 'loading' ? '<span class="pos">연결 확인 중…</span>' :
          '<span class="pos no">❌ ' + esc(st.message || '연결 안 됨') + '</span>';
    h += '<div class="card"><h2>① 카카오 JavaScript 키</h2><input id="s-key" type="text" value="' + esc(s.kakaoKey) + '" placeholder="카카오 개발자 사이트의 JavaScript 키" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button class="btn pri wide" style="margin-top:8px" data-act="save-key">키 저장</button><div style="margin-top:8px">' + stText + '</div>' +
      '<p class="hint">카카오 개발자 사이트에 등록할 이 사이트 주소: <b>' + esc(location.origin) + '</b></p></div>';
    h += '<div class="card"><h2>② 사무실 위치</h2>' +
      (s.office ? '<div class="pos yes">📍 ' + esc(s.office.name) + '</div><p class="hint">' + esc(s.office.address) + '</p>' : '<div class="pos no">아직 지정되지 않았습니다</div>') +
      '<div class="row" style="margin-top:8px"><input id="s-office" type="text" placeholder="사무실 이름 또는 주소" data-enter="office-search" autocomplete="off"><button class="btn pri fit" data-act="office-search">검색</button></div>' +
      resultsHtml(ui.officeResults, 'office-pick') +
      '<p class="hint">검색해서 고르면 바로 바뀝니다. 언제든 다시 바꿀 수 있습니다.</p></div>';
    h += '<div class="card"><h2>③ 백업</h2><p class="hint">데이터는 이 휴대폰의 이 브라우저 안에만 저장됩니다. 브라우저 기록을 지우거나 휴대폰을 바꾸면 사라지므로 <b>가끔 백업 파일을 내보내</b> 보관하세요.</p>' +
      '<button class="btn pri wide" data-act="export">⬇ 백업 파일 내보내기</button><button class="btn wide" style="margin-top:8px" data-act="import">⬆ 백업 파일 불러오기</button>' +
      '<p class="hint">거래처 ' + db.clients.length + '곳 · 방문 기록 ' + db.visits.length + '건</p></div>';
    var hasSample = db.clients.some(function (c) { return c.id.indexOf('sample-') === 0; });
    h += '<div class="card"><h2>연습용 샘플</h2><p class="hint">가상의 학교 5곳과 사무실(서울시청 부근)을 넣어 사용법을 익힐 수 있습니다. 카카오 키 없이도 동선 계산을 해 볼 수 있습니다.</p>' +
      (hasSample ? '<button class="btn danger wide" data-act="sample-remove">샘플 지우기</button>' : '<button class="btn wide" data-act="sample">샘플 넣기</button>') + '</div>';
    h += '<button class="btn danger wide" data-act="wipe">모든 데이터 지우기</button>';
    $('#tab-settings').innerHTML = h;
  }
  function saveKey() {
    var key = $('#s-key').value.trim();
    if (key === db.settings.kakaoKey && KakaoApi.state.status === 'ready') return toast('이미 연결되어 있습니다.');
    db.settings.kakaoKey = key; save();
    location.reload(); // 카카오 지도 프로그램은 키를 바꾸면 화면을 새로 열어야 적용됩니다
  }
  function officeSearch() {
    var q = $('#s-office').value.trim();
    if (!q) return toast('사무실 이름이나 주소를 입력해 주세요.');
    toast('검색 중…');
    Promise.all([KakaoApi.geocode(q).catch(function (e) { return e; }), KakaoApi.searchPlaces(q).catch(function (e) { return e; })]).then(function (r) {
      if (r[0] instanceof Error && r[1] instanceof Error) return toast(r[0].message);
      ui.officeResults = (r[0] instanceof Error ? [] : r[0]).concat(r[1] instanceof Error ? [] : r[1]);
      renderSettings(); $('#s-office').value = q;
    });
  }
  function exportBackup() {
    var data = Object.assign({ app: 'school-route', exportedAt: new Date().toISOString() }, db);
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'sales-route-backup-' + Store.todayStr() + '.json'; // 한글 이름은 일부 브라우저에서 깨져 영문 사용
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
      if (!next.settings.kakaoKey) next.settings.kakaoKey = db.settings.kakaoKey;
      db = next; save();
      location.reload();
    };
    fr.readAsText(file);
  }
  function addSample() {
    if (!db.settings.office) db.settings.office = Object.assign({}, Store.SAMPLE_OFFICE);
    Store.SAMPLE_CLIENTS.forEach(function (s) {
      if (byId(s.id)) return;
      var now = new Date().toISOString();
      db.clients.push(Object.assign({ address: '(연습용 가상 주소)', contactName: '', phone: '', memo: '연습용 샘플입니다.', status: '미방문', placeId: '', createdAt: now, updatedAt: now }, s));
    });
    save(); renderSettings(); toast('샘플 5곳을 넣었습니다. 거래처 탭에서 확인하세요.');
  }
  function removeSample() {
    var isS = function (id) { return id.indexOf('sample-') === 0; };
    db.clients = db.clients.filter(function (c) { return !isS(c.id); });
    db.visits = db.visits.filter(function (v) { return !isS(v.clientId); });
    db.today.selected = db.today.selected.filter(function (id) { return !isS(id); });
    if (db.settings.office && db.settings.office.name === Store.SAMPLE_OFFICE.name) db.settings.office = null;
    save(); renderSettings(); toast('샘플을 지웠습니다.');
  }

  /* ================= 버튼 연결 ================= */
  var ACT = {
    'toggle': function (b) { toggleToday(b.dataset.id); renderClientList(); },
    'open': function (b) { openSheet(b.dataset.id); },
    'new': function () { openSheet(null); },
    'ftype': function (b) { ui.fType = b.dataset.v; renderClients(); },
    'fstatus': function (b) { ui.fStatus = b.dataset.v; renderClients(); },
    'reset-today': resetToday,
    'sheet-close': function () { closeSheet(false); },
    'sheet-save': saveSheet,
    'sheet-delete': deleteClient,
    'search-name': searchName,
    'search-addr': searchAddr,
    'pick': function (b) { syncDraft(); applyResult(ui.results[+b.dataset.i], ui.resultsKind); },
    'set-type': function (b) { syncDraft(); ui.draft.type = b.dataset.v; renderSheet(); },
    'set-status': function (b) { syncDraft(); ui.draft.status = b.dataset.v; renderSheet(); },
    'add-visit': addVisit,
    'del-visit': function (b) {
      if (!confirm('이 방문 기록을 삭제할까요?')) return;
      syncDraft(); db.visits = db.visits.filter(function (v) { return v.id !== b.dataset.id; }); save(); renderSheet();
    },
    'recommend': recommend,
    'restore-rec': function () { db.today.order = db.today.recommended.slice(); save(); renderRoute(); },
    'up': function (b) { moveStop(b.dataset.id, -1); },
    'down': function (b) { moveStop(b.dataset.id, 1); },
    'remove-stop': function (b) { db.today.selected = db.today.selected.filter(function (x) { return x !== b.dataset.id; }); save(); renderRoute(); },
    'visit-toggle': function (b) { toggleVisitToday(b.dataset.id); },
    'go-settings': function () { switchTab('settings'); },
    'go-clients': function () { switchTab('clients'); },
    'save-key': saveKey,
    'office-search': officeSearch,
    'office-pick': function (b) {
      var r = ui.officeResults[+b.dataset.i];
      db.settings.office = { name: r.name, address: r.address, lat: r.lat, lng: r.lng };
      ui.officeResults = null; save(); renderSettings(); toast('사무실 위치를 "' + r.name + '"(으)로 정했습니다.');
    },
    'export': exportBackup,
    'import': function () { $('#import-file').value = ''; $('#import-file').click(); },
    'sample': addSample,
    'sample-remove': removeSample,
    'wipe': function () {
      if (!confirm('거래처, 방문 기록, 설정을 모두 지웁니다.\n되돌릴 수 없습니다. 먼저 백업하셨나요?')) return;
      if (!confirm('정말로 모두 지울까요?')) return;
      db = Store.empty(); save(); location.reload();
    }
  };
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('#nav button');
    if (nav) return switchTab(nav.dataset.tab);
    var b = e.target.closest('[data-act]');
    if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter && !e.isComposing) { e.preventDefault(); ACT[e.target.dataset.enter](e.target); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { ui.q = e.target.value; renderClientList(); }
  });
  $('#import-file').addEventListener('change', function (e) { if (e.target.files[0]) importBackup(e.target.files[0]); });

  /* ================= 시작 ================= */
  initDrag();
  switchTab('clients');
  if (db.settings.kakaoKey) {
    KakaoApi.load(db.settings.kakaoKey).then(render, function () { if (ui.tab !== 'clients') render(); });
  }
})();
