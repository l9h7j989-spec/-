/* 배관·누수 사업 관리 앱 (작업일지 · 수금 · 견적서 · 밴드 공유) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { won, parseMoney } = EstCore;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00'); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };

const JOB_TYPES = ['누수탐지', '누수보수', '배관교체', '막힘·뚫음', '수전·변기', '보일러·난방', '방수', '동파', '기타'];
const PAY_METHODS = ['계좌이체', '현금', '카드', '기타'];
const DEFAULT_SETTINGS = {
  company: { name: '', owner: '', bizno: '', tel: '', phone: '', address: '', account: '', stamp: '' },
  presets: [
    { name: '누수탐지', spec: '', unit: '식', price: 150000 },
    { name: '출장비', spec: '', unit: '회', price: 30000 },
    { name: 'PB관 교체', spec: '15A', unit: 'm', price: 12000 },
    { name: '배관 부분교체', spec: '', unit: '개소', price: 100000 },
    { name: '하수구 막힘 뚫음', spec: '', unit: '식', price: 80000 },
    { name: '타일 철거 및 복구', spec: '', unit: '㎡', price: 60000 },
    { name: '분배기교체', spec: '', unit: '', price: 0 },
    { name: '하수배관 소통작업', spec: '', unit: '', price: 0 },
  ],
  presetsAdded: 2,
  bandTemplate: '{지역}\n{내용}\n\n#누수 #배관',
  smsTemplate: '안녕하세요 {상호}입니다. {날짜} {내용} 공사대금 {금액}원 입금 부탁드립니다.\n{계좌}',
  asMonths: 12,
  notify: { enabled: true, days: 7 },
};

const state = { settings: null, jobs: [], todos: [], estimates: [], calMonth: new Date(), calSel: ymd(), moneyMonth: ymd().slice(0, 7) };

/* ───────── 공통 ───────── */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function payStatus(j) {
  const amt = Number(j.amount) || 0, paid = Number(j.paid) || 0;
  if (!amt) return { key: 'none', label: '금액없음' };
  if (paid >= amt) return { key: 'paid', label: '입금완료' };
  if (paid > 0) return { key: 'part', label: `부분 (${won(amt - paid)} 남음)` };
  return { key: 'unpaid', label: '미수' };
}
const unpaidOf = (j) => Math.max(0, (Number(j.amount) || 0) - (Number(j.paid) || 0));
function fill(tpl, map) { return tpl.replace(/\{([^{}]+)\}/g, (m, k) => (k in map ? map[k] : m)); }
function areaOf(addr) { // 개인정보 보호: 시/구/동 까지만
  if (!addr) return '';
  const parts = addr.split(/\s+/).filter((p) => /(시|도|구|군|동|읍|면)$/.test(p));
  return parts.slice(0, 3).join(' ');
}
async function loadAll() {
  state.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), await DB.getKV('settings', {}));
  // 이미 쓰던 단가표에 새 자주 쓰는 품목 추가 (한 번만)
  if ((state.settings.presetsAdded || 0) < 2) {
    for (const name of ['분배기교체', '하수배관 소통작업'])
      if (!state.settings.presets.some((x) => x.name === name)) state.settings.presets.push({ name, spec: '', unit: '', price: 0 });
    state.settings.presetsAdded = 2;
  }
  [state.jobs, state.todos, state.estimates] = await Promise.all([DB.all('jobs'), DB.all('todos'), DB.all('estimates')]);
}
const saveSettings = () => DB.setKV('settings', state.settings);

function openSheet(html, onMount) {
  const sh = $('#sheet');
  $('#sheet-body').innerHTML = html;
  sh.classList.add('open');
  document.body.classList.add('noscroll');
  $('#sheet-body').scrollTop = 0;
  onMount && onMount($('#sheet-body'));
}
function closeSheet() { $('#sheet').classList.remove('open'); document.body.classList.remove('noscroll'); render(); }

/* ───────── 라우팅 ───────── */
const VIEWS = { home: renderHome, cal: renderCal, est: renderEstList, money: renderMoney, more: renderMore };
function route() { return (location.hash.slice(1) || 'home').split('/')[0]; }
function render() {
  if (!state.settings) return; // 아직 불러오는 중
  const v = VIEWS[route()] ? route() : 'home';
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  VIEWS[v]($('#view'));
}

/* ───────── 작업 카드 ───────── */
// 작업 이름: 고객명이 없으면 붙여넣은 글의 첫 줄
function jobName(j) {
  if (j.customer) return j.customer;
  const first = String(j.desc || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  return first ? (first.length > 24 ? first.slice(0, 24) + '…' : first) : '(내용 없음)';
}
function jobCard(j) {
  const lines = String(j.desc || '').split(/\r?\n/).filter((l) => l.trim());
  const preview = (j.customer ? lines : lines.slice(1)).slice(0, 3).join('\n');
  return `<div class="card job" data-job="${j.id}">
    <div class="row"><b>${esc(jobName(j))}</b></div>
    ${preview ? `<div class="desc">${esc(preview.slice(0, 160))}</div>` : ''}
  </div>`;
}
function bindJobCards(el) { $$('[data-job]', el).forEach((c) => c.onclick = () => editJob(c.dataset.job)); }

/* ───────── 할일 ───────── */
function todoList(list, opts = {}) {
  if (!list.length) return `<p class="empty">${opts.empty || '할 일이 없습니다'}</p>`;
  return `<ul class="todos">${list.map((t) => `<li class="${t.done ? 'done' : ''}">
    <label><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}> <span>${esc(t.text)}</span></label>
    ${opts.showDate ? `<small>${fmtDate(t.date)}</small>` : ''}<button class="x" data-deltodo="${t.id}" aria-label="삭제">×</button></li>`).join('')}</ul>`;
}
function bindTodos(el) {
  $$('[data-todo]', el).forEach((c) => c.onchange = async () => {
    const t = state.todos.find((x) => x.id === c.dataset.todo); t.done = c.checked; await DB.put('todos', t); render();
  });
  $$('[data-deltodo]', el).forEach((b) => b.onclick = async () => {
    await DB.del('todos', b.dataset.deltodo); state.todos = state.todos.filter((x) => x.id !== b.dataset.deltodo); render();
  });
  $$('form.addtodo', el).forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    const t = { id: uid(), date: f.dataset.date, text, done: false }; await DB.put('todos', t); state.todos.push(t); render();
  });
}
const addTodoForm = (date) => `<form class="addtodo" data-date="${date}"><input name="text" placeholder="할 일 추가 (예: 자재 주문, 김사장님 전화)" autocomplete="off"><button>추가</button></form>`;

/* ───────── 홈 ───────── */
function renderHome(el) {
  const today = ymd(), month = today.slice(0, 7);
  const todayJobs = state.jobs.filter((j) => j.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const monthJobs = state.jobs.filter((j) => (j.date || '').startsWith(month));
  const sales = monthJobs.reduce((a, j) => a + (Number(j.amount) || 0), 0);
  const unpaid = state.jobs.reduce((a, j) => a + unpaidOf(j), 0);
  const unpaidCnt = state.jobs.filter((j) => unpaidOf(j) > 0).length;
  const todayTodos = state.todos.filter((t) => t.date === today);
  const overdue = state.todos.filter((t) => !t.done && t.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const asSoon = state.jobs.filter((j) => j.asUntil && j.asUntil >= today && j.asUntil <= ymd(new Date(Date.now() + 30 * 864e5)));
  el.innerHTML = `
    <p class="eyebrow">${(() => { const d = new Date(today + 'T00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`; })()}</p>
    <h2 class="large">오늘</h2>
    ${state.jobs.some((x) => Number(x.amount) > 0) ? `<div class="stats">
      <div class="stat"><small>이번 달 매출</small><b>${won(sales)}</b></div>
      <div class="stat warn" onclick="location.hash='money'"><small>받을 돈 (${unpaidCnt}건)</small><b>${won(unpaid)}</b></div>
    </div>` : ''}
    ${!isStandalone() && (installEvt || isIOS()) && !localStorage.getItem('hideInstall') ? `<div class="banner">📲 홈 화면에 설치하면 앱처럼 씁니다 <button class="btn sm primary" id="q-inst">설치</button><button class="x" id="q-hide">×</button></div>` : ''}
    <div class="quick"><button class="btn primary" id="q-job">＋ 기록</button><button class="btn" id="q-est">＋ 견적서</button></div>
    ${workSummary(today, 'stats')}
    <h3>오늘 기록 <small>${todayJobs.length}건</small></h3>
    ${todayJobs.map(jobCard).join('') || '<p class="empty">오늘 기록이 없습니다</p>'}
    <h3>오늘 할 일</h3>
    ${todoList(todayTodos)}
    ${addTodoForm(today)}
    ${overdue.length ? `<h3 class="red">밀린 할 일 <small>${overdue.length}</small></h3>${todoList(overdue, { showDate: true })}` : ''}
    ${asSoon.length ? `<h3>A/S 기간 곧 끝남 (30일 이내)</h3>${asSoon.map(jobCard).join('')}` : ''}
    ${workSummary(today, 'past')}`;
  $('#q-job').onclick = () => editJob(null, today);
  $('#q-est').onclick = () => editEstimate(null);
  const qi = $('#q-inst'); if (qi) qi.onclick = async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); } else location.hash = 'more'; };
  const qh = $('#q-hide'); if (qh) qh.onclick = () => { try { localStorage.setItem('hideInstall', '1'); } catch (e) { /* 무시 */ } render(); };
  $$('[data-goto]', el).forEach((b) => b.onclick = () => { state.calSel = b.dataset.goto; state.calMonth = new Date(b.dataset.goto + 'T00:00'); location.hash = 'cal'; });
  bindJobCards(el); bindTodos(el);
}

// 일한 날 = 기록이 있는 날짜
function workSummary(today, part) {
  const days = [...new Set(state.jobs.map((j) => j.date).filter(Boolean))].sort();
  const t = new Date(today + 'T00:00');
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7)); // 이번 주 월요일
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const inRange = (a, b) => days.filter((d) => d >= a && d <= b).length;
  const week = inRange(ymd(mon), ymd(sun)), month = days.filter((d) => d.startsWith(today.slice(0, 7))).length, year = days.filter((d) => d.startsWith(today.slice(0, 4))).length;
  const past = days.filter((d) => d < today).reverse().slice(0, 10);
  const lastYear = String(Number(today.slice(0, 4)) - 1), lastYearDays = days.filter((d) => d.startsWith(lastYear)).length;
  const firstLine = (d) => { const j = state.jobs.find((x) => x.date === d); return j ? jobName(j) : ''; };
  if (part === 'past') return past.length ? `<h3>지난 일한 날 <small>최근 ${past.length}일 · 누르면 달력으로</small></h3>
      <div class="pastlist">${past.map((d) => { const n = state.jobs.filter((j) => j.date === d).length; return `<button class="pastday" data-goto="${d}"><b>${d.slice(0, 4)}. ${fmtDate(d)}</b><span>${esc(firstLine(d))}</span>${n > 1 ? `<small>${n}건</small>` : ''}</button>`; }).join('')}</div>` : '';
  return `<h3>일한 날</h3>
    <div class="stats three">
      <div class="stat"><small>이번 주</small><b>${week}일</b></div>
      <div class="stat"><small>${Number(today.slice(5, 7))}월</small><b>${month}일</b></div>
      <div class="stat"><small>${today.slice(0, 4)}년</small><b>${year}일</b></div>
    </div>
    ${lastYearDays ? `<p class="hint">${lastYear}년: ${lastYearDays}일 · 전체 기록 ${days.length}일</p>` : (days.length ? `<p class="hint">전체 기록 ${days.length}일</p>` : '')}
`;
}

/* ───────── 달력 ───────── */
function renderCal(el) {
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1), startDow = first.getDay(), days = new Date(y, mo + 1, 0).getDate();
  const today = ymd();
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const js = state.jobs.filter((j) => j.date === ds);
    const ts = state.todos.filter((t) => t.date === ds && !t.done);
    const sum = js.reduce((a, j) => a + (Number(j.amount) || 0), 0);
    const hasUnpaid = js.some((j) => unpaidOf(j) > 0);
    const dow = (startDow + d - 1) % 7;
    cells += `<div class="cell ${ds === today ? 'today' : ''} ${ds === state.calSel ? 'sel' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}" data-d="${ds}">
      <span class="dn">${d}</span>
      ${js.length ? `<span class="dot ${hasUnpaid ? 'unpaid' : 'rec'}">${js.length}</span>` : ''}
      ${ts.length ? '<span class="tdot"></span>' : ''}
      ${sum ? `<span class="amt">${sum >= 10000 ? Math.round(sum / 10000) + '만' : won(sum)}</span>` : ''}</div>`;
  }
  const sel = state.calSel;
  const dayJobs = state.jobs.filter((j) => j.date === sel).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayTodos = state.todos.filter((t) => t.date === sel);
  el.innerHTML = `
    <div class="searchbox"><input type="search" id="calq" placeholder="🔍 기록·할 일 검색 (예: 209동, 분배기)" value="${esc(state.calQuery || '')}" autocomplete="off"></div>
    <div id="calres"></div>
    <div class="calhead"><button class="btn sm" id="pm">‹</button><button class="caltitle" id="calpick">${y}년 ${mo + 1}월 ▾</button><button class="btn sm" id="nm">›</button></div>
    <div class="jumpbox" id="jumpbox" ${state.calJump ? '' : 'hidden'}>
      <select id="jy">${(() => { const ys = new Set([new Date().getFullYear() + 1]); for (let k = new Date().getFullYear(); k >= 2015; k--) ys.add(k); state.jobs.forEach((j) => j.date && ys.add(Number(j.date.slice(0, 4)))); return [...ys].sort((a, b) => b - a).map((k) => `<option value="${k}" ${k === y ? 'selected' : ''}>${k}년</option>`).join(''); })()}</select>
      <select id="jm">${[...Array(12).keys()].map((k) => `<option value="${k + 1}" ${k === mo ? 'selected' : ''}>${k + 1}월</option>`).join('')}</select>
      <select id="jd"></select>
      <button class="btn sm primary" id="jgo">이동</button><button class="btn sm" id="jtoday">오늘</button>
    </div>
    <div class="legend"><span class="dot rec">n</span> 기록 수 <span class="tdot"></span> 할 일</div>
    <div class="cal">${WEEK.map((w) => `<div class="wk">${w}</div>`).join('')}${cells}</div>
    <h3>${fmtDate(sel)} <button class="btn sm primary" id="add-job">＋ 기록</button></h3>
    ${dayJobs.map(jobCard).join('') || '<p class="empty">기록 없음</p>'}
    <h3>할 일</h3>${todoList(dayTodos)}${addTodoForm(sel)}`;
  const q = $('#calq');
  q.oninput = () => { state.calQuery = q.value; drawSearch($('#calres')); };
  drawSearch($('#calres'));
  const fillDays = () => {
    const yy = Number($('#jy').value), mm = Number($('#jm').value), n = new Date(yy, mm, 0).getDate();
    const keep = Number($('#jd').value) || (state.calSel && state.calSel.startsWith(`${yy}-${pad(mm)}`) ? Number(state.calSel.slice(8)) : 1);
    $('#jd').innerHTML = [...Array(n).keys()].map((k) => `<option value="${k + 1}" ${k + 1 === Math.min(keep, n) ? 'selected' : ''}>${k + 1}일</option>`).join('');
  };
  fillDays(); $('#jy').onchange = fillDays; $('#jm').onchange = fillDays;
  $('#calpick').onclick = () => { state.calJump = !state.calJump; $('#jumpbox').hidden = !state.calJump; };
  const jumpTo = (ds) => { state.calSel = ds; state.calMonth = new Date(ds + 'T00:00'); state.calJump = false; render(); };
  $('#jgo').onclick = () => jumpTo(`${$('#jy').value}-${pad($('#jm').value)}-${pad($('#jd').value)}`);
  $('#jtoday').onclick = () => jumpTo(ymd());
  $('#pm').onclick = () => { state.calMonth = new Date(y, mo - 1, 1); render(); };
  $('#nm').onclick = () => { state.calMonth = new Date(y, mo + 1, 1); render(); };
  $$('.cell[data-d]', el).forEach((c) => c.onclick = () => { state.calSel = c.dataset.d; render(); });
  $('#add-job').onclick = () => editJob(null, sel);
  bindJobCards(el); bindTodos(el);
}

// 기록·할 일 검색: 띄어쓰기로 나눈 단어가 모두 들어간 것 (최근 날짜 순)
function drawSearch(box) {
  const words = String(state.calQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = ''; return; }
  const hit = (t) => { const l = String(t || '').toLowerCase(); return words.every((w) => l.includes(w)); };
  const res = [
    ...state.jobs.filter((j) => hit([j.desc, j.customer, j.address, j.memo].join(' '))).map((j) => ({ kind: 'job', id: j.id, date: j.date, text: j.desc || j.customer || '' })),
    ...state.todos.filter((t) => hit(t.text)).map((t) => ({ kind: 'todo', id: t.id, date: t.date, text: t.text, done: t.done })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const mark = (t) => {
    // 첫 번째 찾은 단어 근처만 잘라서 보여주고 강조
    const l = t.toLowerCase(); const i = Math.max(0, l.indexOf(words[0]) - 20);
    let out = esc((i > 0 ? '…' : '') + t.slice(i, i + 90).replace(/\s+/g, ' ') + (t.length > i + 90 ? '…' : ''));
    for (const w of words) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
    return out;
  };
  box.innerHTML = `<p class="hint">찾은 것 ${res.length}건 ${res.length ? '— 누르면 그 날짜로 갑니다' : ''}</p>` + res.slice(0, 100).map((r) => `
    <div class="card result" data-kind="${r.kind}" data-id="${r.id}" data-date="${r.date}">
      <div class="sub">${fmtDate(r.date)} ${r.date ? r.date.slice(0, 4) + '년' : ''} · ${r.kind === 'job' ? '기록' : '할 일' + (r.done ? ' ✔' : '')}</div>
      <div class="desc">${mark(r.text)}</div></div>`).join('');
  $$('.result', box).forEach((c) => c.onclick = () => {
    const d = c.dataset.date; state.calSel = d; state.calMonth = new Date(d + 'T00:00');
    state.calQuery = ''; render();
    if (c.dataset.kind === 'job') editJob(c.dataset.id);
    else document.querySelector('.todos')?.scrollIntoView({ behavior: 'smooth' });
  });
}

/* ───────── 사진 ───────── */
async function resizeImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const r = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
const photoURLs = new Map();
async function photoURL(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  let blob = (await DB.get('photos', id))?.blob;
  if (!blob && Cloud.ready) blob = await Cloud.fetchPhoto(id);
  if (!blob) return '';
  const u = URL.createObjectURL(blob); photoURLs.set(id, u); return u;
}

/* ───────── 작업 편집 ───────── */
async function editJob(id, date) {
  // 작업 기록 = 날짜 + 글(카톡·메모 붙여넣기)만. 예전 기록의 다른 값은 건드리지 않고 그대로 둔다.
  const j = id ? structuredClone(state.jobs.find((x) => x.id === id)) : {
    id: uid(), date: date || ymd(), desc: '', customer: '', phone: '', address: '', type: '', time: '',
    amount: 0, paid: 0, photos: [], checklist: [], memo: '', status: 'plan',
  };
  const isNew = !id;
  openSheet(`
    <div class="sheethead"><h2>${isNew ? '새 기록' : '기록'}</h2><button class="btn sm" data-close>닫기</button></div>
    <form id="jobf" class="form">
      <label>날짜<input type="date" name="date" value="${j.date}" required></label>
      <label>내용 <small>— 카톡·메모를 그대로 붙여넣으면 됩니다</small>
        <textarea name="desc" rows="14" placeholder="예) 미메이드아파트 209동 603호&#10;욕실 배관교체, 철거 및 복구, 세척작업">${esc(j.desc)}</textarea></label>
      <div class="row wrap"><button type="button" class="btn sm" id="jpaste">📋 붙여넣기</button></div>
      <div class="actions"><button class="btn primary big">저장</button></div>
      ${isNew ? '' : '<div class="actions"><button type="button" class="btn danger" id="del">삭제</button></div>'}
    </form>`, (root) => {
    const f = $('#jobf', root);
    $('#jpaste', root).onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('복사된 글이 없습니다'); return; }
        f.desc.value = f.desc.value ? f.desc.value.trimEnd() + '\n' + t : t;
        toast('붙여넣었습니다');
      } catch (err) { f.desc.focus(); toast('내용 칸을 길게 눌러 붙여넣기 하세요'); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.desc.value.trim()) { toast('내용을 넣어주세요'); return; }
      j.date = f.date.value; j.desc = f.desc.value.trim();
      await DB.put('jobs', j);
      const i = state.jobs.findIndex((x) => x.id === j.id); if (i >= 0) state.jobs[i] = j; else state.jobs.push(j);
      toast('저장했습니다'); closeSheet();
    };
    $('[data-close]', root).onclick = closeSheet;
    const del = $('#del', root);
    if (del) del.onclick = async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      for (const p of j.photos || []) await DB.del('photos', p);
      await DB.del('jobs', j.id); state.jobs = state.jobs.filter((x) => x.id !== j.id); closeSheet();
    };
  });
}

function smsLink(j) {
  const c = state.settings.company;
  const body = fill(state.settings.smsTemplate, {
    상호: c.name || '', 날짜: fmtDate(j.date), 내용: j.type || '공사', 금액: won(unpaidOf(j) || j.amount),
    계좌: c.account || '', 고객: j.customer || '',
  });
  return `sms:${(j.phone || '').replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;
}

/* ───────── 밴드 공유 ─────────
 * 밴드 공식 Open API 글쓰기는 텍스트만 지원하므로, 사진+글은 휴대폰 '공유하기'로 밴드 앱에 넘긴다.
 * 사용자는 밴드 앱에서 밴드 선택 → [게시] 만 누르면 된다. */
async function shareToBand(j) {
  const text = fill(state.settings.bandTemplate, {
    유형: j.type || '', 지역: areaOf(j.address), 내용: j.desc || '', 날짜: fmtDate(j.date), 고객: '',
  }).replace(/\[\s*\]\s*/g, '').replace(/#\s/g, '').replace(/#(?=\s|$)/g, '').trim();
  const files = [];
  for (const pid of j.photos || []) {
    let p = await DB.get('photos', pid);
    if (!p && Cloud.ready) { const b = await Cloud.fetchPhoto(pid); if (b) p = { blob: b }; }
    if (p) files.push(new File([p.blob], `photo_${files.length + 1}.jpg`, { type: 'image/jpeg' }));
  }
  const markShared = async () => {
    j.bandShared = true; const c = j.checklist.find((x) => x.t === '밴드 업로드'); if (c) c.d = true;
    await DB.put('jobs', j); const i = state.jobs.findIndex((x) => x.id === j.id); if (i >= 0) state.jobs[i] = j;
  };
  try { await navigator.clipboard.writeText(text); } catch (e) { /* 무시 */ }
  if (files.length && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, text, title: j.type || '' });
      await markShared(); toast('공유 완료. 글이 빠졌으면 붙여넣기 하세요(복사됨)');
    } catch (e) { if (e.name !== 'AbortError') toast('공유 실패: ' + e.message); }
    return;
  }
  // 사진 공유가 안 되는 환경(PC 등): 글만 밴드 공유창으로
  const url = `https://band.us/plugin/share?body=${encodeURIComponent(text)}&route=${encodeURIComponent(location.host || 'localhost')}`;
  window.open(url, '_blank', 'noopener');
  await markShared();
  toast(files.length ? '이 기기는 사진 공유를 지원하지 않아 글만 보냈습니다. 휴대폰에서 다시 시도하세요' : '밴드 공유창을 열었습니다');
}

/* ───────── 견적서 ───────── */
function renderEstList(el) {
  const tab = state.docTab || 'est'; // 'est' 견적서, 'op' 소견서
  const isOp = tab === 'op';
  const list = state.estimates.filter((x) => (x.doc === 'opinion') === isOp).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const sel = state.estSel; // null = 보통 화면, Set = 선택 모드
  el.innerHTML = `<div class="tabs"><button class="${isOp ? '' : 'on'}" id="tab-est">📄 견적서</button><button class="${isOp ? 'on' : ''}" id="tab-op">💧 누수 소견서</button></div>
    <h2>${isOp ? '누수 소견서' : '견적서'} <small>${list.length}건</small></h2>
    ${sel ? `<div class="selbar">
        <button class="btn sm" id="sel-all">${sel.size === list.length && list.length ? '전체 해제' : '전체 선택'}</button>
        <button class="btn sm danger" id="sel-del" ${sel.size ? '' : 'disabled'}>선택 삭제 (${sel.size})</button>
        <button class="btn sm danger" id="all-del" ${list.length ? '' : 'disabled'}>전체 삭제</button>
        <button class="btn sm" id="sel-cancel">취소</button></div>`
    : `<button class="btn primary big" id="new-est">＋ 새 ${isOp ? '소견서' : '견적서'}</button>
       ${list.length ? '<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn sm" id="sel-on">☑ 선택 · 삭제</button></div>' : ''}`}
    ${list.map((e) => { const t = isOp ? null : EstCore.calcTotals(e.items || [], e.vatMode); return `<div class="card ${sel && sel.has(e.id) ? 'picked' : ''}" data-est="${e.id}">
      <div class="row">${sel ? `<input type="checkbox" class="pick" ${sel.has(e.id) ? 'checked' : ''} aria-label="선택">` : ''}<b class="grow">${esc((isOp ? e.location : e.address || e.customer) || '(위치 미입력)')}</b>${isOp ? '' : `<span>${won(t.total)}원</span>`}</div>
      <div class="sub">${fmtDate(e.date)}${isOp ? (e.repair ? ' · ' + esc(e.repair.slice(0, 40)) : '') : (e.title ? ' · ' + esc(e.title) : '')}</div></div>`; }).join('') || `<p class="empty">저장된 ${isOp ? '소견서' : '견적서'}가 없습니다</p>`}`;
  $('#tab-est').onclick = () => { state.docTab = 'est'; state.estSel = null; render(); };
  $('#tab-op').onclick = () => { state.docTab = 'op'; state.estSel = null; render(); };
  const delMany = async (ids, msg) => {
    if (!ids.length || !confirm(msg)) return;
    for (const id of ids) await DB.del('estimates', id);
    state.estimates = state.estimates.filter((x) => !ids.includes(x.id));
    state.estSel = null; toast(`${ids.length}건 삭제했습니다`); render();
  };
  if (sel) {
    $('#sel-all').onclick = () => { state.estSel = sel.size === list.length ? new Set() : new Set(list.map((x) => x.id)); render(); };
    $('#sel-del').onclick = () => delMany([...sel], `선택한 ${isOp ? '소견서' : '견적서'} ${sel.size}건을 삭제할까요?\n(되돌릴 수 없습니다)`);
    $('#all-del').onclick = () => delMany(list.map((x) => x.id), `${isOp ? '소견서' : '견적서'} ${list.length}건을 모두 삭제할까요?\n(되돌릴 수 없습니다)`);
    $('#sel-cancel').onclick = () => { state.estSel = null; render(); };
    $$('[data-est]', el).forEach((c) => c.onclick = () => { const id = c.dataset.est; if (sel.has(id)) sel.delete(id); else sel.add(id); render(); });
  } else {
    $('#new-est').onclick = () => (isOp ? editOpinion(null) : editEstimate(null));
    const on = $('#sel-on'); if (on) on.onclick = () => { state.estSel = new Set(); render(); };
    $$('[data-est]', el).forEach((c) => c.onclick = () => (isOp ? editOpinion(c.dataset.est) : editEstimate(c.dataset.est)));
  }
}

/* ───────── 누수 소견서 ─────────
 * 사장님 소견서 양식(.hwp)에서 수리 내역 · 누수 발생 위치 · 누수 발생 원인(= 수리 내역) · 날짜만 바꿔 HWP 로 만든다. */
function editOpinion(id) {
  const o = id ? structuredClone(state.estimates.find((x) => x.id === id)) : { id: uid(), doc: 'opinion', date: ymd(), location: '', repair: '' };
  openSheet(`
    <div class="sheethead"><h2>누수 소견서</h2><button class="btn sm" data-close>닫기</button></div>
    <div class="form">
      <p class="hint red" id="opwarn" hidden></p>
      <label>날짜 <small>(소견서 맨 아래 날짜)</small><input type="date" id="o-date" value="${o.date}"></label>
      <label>누수 발생 위치 <small>(파일 이름이 됨)</small><input id="o-loc" value="${esc(o.location)}" placeholder="예: 미메이드아파트 209동 603호"></label>
      <label>수리 내역<textarea id="o-repair" rows="5" placeholder="예: DRF하수배관고무패킹 경화로인한 누수 발생하여 부품 교체 및 704호천정 세척 하였음">${esc(o.repair)}</textarea></label>
      <div class="row wrap"><button type="button" class="btn sm" id="o-paste">📋 붙여넣기</button></div>
      <div class="totals"><small>누수 발생 원인에는 <b>수리 내역과 같은 글</b>이 들어갑니다.</small>
        <div style="display:block"><small>파일 이름: <b id="o-fname"></b></small></div></div>
      <div class="actions wrap">
        <button class="btn primary big" id="o-save">저장</button>
        <button class="btn primary" id="o-hwp">⬇ 한글(HWP) 받기</button>
        ${id ? '<button class="btn danger" id="o-del">삭제</button>' : ''}
      </div>
    </div>`, (root) => {
    const fname = () => `${($('#o-loc', root).value.trim() || '누수위치').replace(/[\\/:*?"<>|]/g, '')} 누수소견서.hwp`;
    const showName = () => { $('#o-fname', root).textContent = fname(); };
    $('#o-loc', root).oninput = showName; showName();
    DB.getKV('opinionTemplateName', '').then((n) => {
      if (n) return;
      const w = $('#opwarn', root); w.hidden = false;
      w.innerHTML = '⚠️ 소견서 양식(.hwp)이 아직 없습니다. <a href="#more" id="goop">⚙️ 설정에서 소견서 양식 올리기</a>';
      $('#goop', root).onclick = () => { closeSheet(); location.hash = 'more'; };
    });
    $('#o-paste', root).onclick = async () => {
      try { const t = await navigator.clipboard.readText(); if (t) { $('#o-repair', root).value = t.trim(); toast('붙여넣었습니다'); } }
      catch (err) { $('#o-repair', root).focus(); toast('칸을 길게 눌러 붙여넣기 하세요'); }
    };
    const save = async (quiet) => {
      o.date = $('#o-date', root).value; o.location = $('#o-loc', root).value.trim(); o.repair = $('#o-repair', root).value.trim();
      await DB.put('estimates', o);
      const i = state.estimates.findIndex((x) => x.id === o.id); if (i >= 0) state.estimates[i] = o; else state.estimates.push(o);
      if (!quiet) toast('소견서를 저장했습니다');
    };
    $('#o-save', root).onclick = async () => { await save(); closeSheet(); };
    $('#o-hwp', root).onclick = async () => {
      await save(true);
      if (!o.location || !o.repair) { toast('누수 발생 위치와 수리 내역을 넣어주세요'); return; }
      const tpl = await DB.getKV('opinionTemplate', null);
      if (!tpl) { if (confirm('소견서 양식(.hwp)을 먼저 올려야 합니다. 설정으로 갈까요?')) { closeSheet(); location.hash = 'more'; } return; }
      try {
        const bytes = await Hwp5.fillOpinion(tpl, { date: o.date, location: o.location, repair: o.repair });
        if (bytes.warnings && bytes.warnings.length) alert(bytes.warnings.join('\n'));
        const name = fname();
        const blob = new Blob([bytes], { type: 'application/x-hwp' });
        downloadBlob(blob, name); toast('휴대폰에 저장했습니다');
      } catch (err) { console.error(err); alert('소견서 만들기 실패: ' + err.message); }
    };
    const d = $('#o-del', root);
    if (d) d.onclick = async () => { if (!confirm('소견서를 삭제할까요?')) return; await DB.del('estimates', o.id); state.estimates = state.estimates.filter((x) => x.id !== o.id); closeSheet(); };
    $('[data-close]', root).onclick = closeSheet;
  });
}

const EXAMPLE_TEXT = `현장: 미메이드아파트 209동 603호
공사: 욕실 배관 공사
배관교체 30만
철거및복구 20만
세척작업 20만`;

function editEstimate(id, fromJob) {
  const e = id ? structuredClone(state.estimates.find((x) => x.id === id)) : {
    id: uid(), date: ymd(), customer: fromJob?.customer || '', phone: fromJob?.phone || '', address: fromJob?.address || '',
    title: fromJob ? (fromJob.type ? `${fromJob.type} 공사` : '') : '', items: [], vatMode: 'separate', memo: '', validDays: 30, jobId: fromJob?.id || '', raw: '',
  };
  openSheet(`
    <div class="sheethead"><h2>견적서</h2><button class="btn sm" data-close>닫기</button></div>
    <div class="form">
      <details ${e.items.length ? '' : 'open'}><summary>✍️ 글로 한 번에 입력 (자동 채우기)</summary>
        <textarea id="raw" rows="8" placeholder="${esc(EXAMPLE_TEXT)}">${esc(e.raw || '')}</textarea>
        <div class="row wrap">
          <button type="button" class="btn sm" id="paste">📋 붙여넣기</button>
          <button type="button" class="btn sm" id="ex">예시</button>
          <button type="button" class="btn primary" id="parse">자동 채우기 ↓</button>
        </div>
        <p class="hint"><code>현장:</code> <code>공사:</code> 줄과, 한 줄에 품목 하나 <code>품명 단가</code> (예: 배관교체 30만). 수량·단위는 안 적어도 됩니다. 결과는 아래에서 고칠 수 있습니다.</p>
        <p class="hint red" id="unparsed"></p>
      </details>
      <label>날짜<input type="date" id="e-date" value="${e.date}"></label>
      <label>현장 <small>(예: ○○아파트 209동 603호)</small><input id="e-address" value="${esc(e.address || e.customer || '')}"></label>
      <label>공사명<input id="e-title" value="${esc(e.title)}"></label>
      <h3>품목</h3>
      <div id="items"></div>
      <div class="row wrap"><button type="button" class="btn sm" id="add-item">＋ 빈 줄</button>
      ${state.settings.presets.map((p, i) => `<button type="button" class="btn sm chip" data-preset="${i}">${esc(p.name)}</button>`).join('')}</div>
      <div class="totals" id="totals"></div>
      <div class="actions wrap">
        <button class="btn primary big" id="e-save">저장</button>
        <button class="btn primary" id="e-hwp">⬇ 한글(HWPX) 받기</button>
        <button class="btn primary" id="e-xlsx">⬇ 엑셀 받기</button>
        <button class="btn" id="e-print">🖨 인쇄 / PDF</button>
        ${id ? '<button class="btn danger" id="e-del">삭제</button>' : ''}
      </div>
      <p class="hint red" id="tplwarn" hidden></p>
    </div>`, (root) => {
    if (!e.address && e.customer) e.address = e.customer; // 예전 견적: 고객명을 현장으로
    e.vatMode = 'separate'; e.memo = ''; e.customer = ''; e.phone = ''; // 양식: 부가세 별도, 고객·연락처·특기사항 없음
    // 상호가 빠진 견적서가 나가지 않도록: 사장님 양식이 없고 업체정보도 비었으면 경고
    const tplMissing = async (kind) => {
      const own = await DB.getKV(kind === 'xlsx' ? 'xlsxTemplateName' : 'templateName', '');
      return !own && !state.settings.company.name;
    };
    DB.getKV('xlsxTemplateName', '').then((n) => {
      const w = $('#tplwarn', root); if (!w || /\.xls$/i.test(n || '')) return;
      w.hidden = false;
      w.innerHTML = '⚠️ 사장님 엑셀 견적서 양식이 아직 없습니다. <a href="#more" id="gotpl">⚙️ 설정에서 양식 올리기 (처음 한 번)</a>';
      $('#gotpl', root).onclick = () => { closeSheet(); location.hash = 'more'; };
    });
    const okToMake = async (kind) => {
      if (!(await tplMissing(kind))) return true;
      if (confirm('사장님 양식이 올라가 있지 않아 상호·대표·도장이 빈 견적서가 만들어집니다.\n\n[확인] 설정으로 가서 양식 올리기\n[취소] 그래도 빈 양식으로 만들기')) {
        closeSheet(); location.hash = 'more'; return false;
      }
      return true;
    };
    const read = () => {
      e.date = $('#e-date', root).value; e.address = $('#e-address', root).value.trim();
      e.title = $('#e-title', root).value.trim(); e.raw = $('#raw', root).value;
    };
    const drawTotals = () => {
      const t = EstCore.calcTotals(e.items, 'separate');
      $('#totals', root).innerHTML = `<div class="big">합계금액 <b>${won(t.total)}원</b></div><small>合計金額 : ${EstCore.toKoreanMoney(t.total)}원整 (￦ ${won(t.total)}) *부가가치세 별도 — 품목 금액을 더해 자동 계산</small>`;
    };
    const drawItems = () => {
      $('#items', root).innerHTML = e.items.map((it, i) => `<div class="item" data-i="${i}">
        <input data-k="name" value="${esc(it.name)}" placeholder="품명" class="w-name">
        <input data-k="spec" value="${esc(it.spec)}" placeholder="규격" class="w-s">
        <input data-k="qty" value="${esc(it.qty ?? '')}" inputmode="decimal" placeholder="수량" class="w-s">
        <input data-k="unit" value="${esc(it.unit)}" placeholder="단위" class="w-s">
        <input data-k="price" value="${it.price ? won(it.price) : ''}" inputmode="numeric" placeholder="단가" class="w-m">
        <span class="amt ${it.price ? '' : 'red'}">${it.price ? won(EstCore.lineAmount(it)) : '단가?'}</span>
        <input data-k="note" value="${esc(it.note || '')}" placeholder="비고" class="w-m">
        <button type="button" class="x" data-idel="${i}">×</button></div>`).join('') || '<p class="empty">품목이 없습니다</p>';
      $$('.item input', root).forEach((inp) => inp.onchange = () => {
        const it = e.items[inp.closest('.item').dataset.i], k = inp.dataset.k;
        it[k] = k === 'price' ? parseMoney(inp.value) || 0 : k === 'qty' ? (inp.value.trim() === '' ? '' : parseFloat(inp.value) || '') : inp.value;
        drawItems();
      });
      $$('[data-idel]', root).forEach((b) => b.onclick = () => { e.items.splice(b.dataset.idel, 1); drawItems(); });
      drawTotals();
    };
    drawItems();
    $('#ex', root).onclick = () => { $('#raw', root).value = EXAMPLE_TEXT; };
    $('#paste', root).onclick = async () => {
      try { const t = await navigator.clipboard.readText(); if (t) { $('#raw', root).value = t; toast('붙여넣었습니다'); } else toast('복사된 글이 없습니다'); }
      catch (err) { $('#raw', root).focus(); toast('글칸을 길게 눌러 붙여넣기 하세요'); }
    };
    $('#parse', root).onclick = () => {
      const r = EstCore.parseEstimateText($('#raw', root).value);
      const set = (sel, v) => { if (v) $(sel, root).value = v; };
      set('#e-address', r.fields.address || r.fields.customer); set('#e-title', r.fields.title);
      if (r.fields.date && /^\d{4}-\d{2}-\d{2}$/.test(r.fields.date)) set('#e-date', r.fields.date);
      if (r.items.length) e.items = r.items;
      $('#unparsed', root).textContent = r.unparsed.length ? '이해하지 못한 줄: ' + r.unparsed.join(' / ') : '';
      drawItems(); toast(`품목 ${r.items.length}개를 채웠습니다`);
    };
    $('#add-item', root).onclick = () => { e.items.push({ name: '', spec: '', qty: '', unit: '', price: 0, note: '' }); drawItems(); };
    $$('[data-preset]', root).forEach((b) => b.onclick = () => { const p = state.settings.presets[b.dataset.preset]; e.items.push({ ...p, qty: '', note: '' }); drawItems(); });
    const save = async (quiet) => {
      read(); e.items = e.items.filter((it) => it.name);
      await DB.put('estimates', e);
      const i = state.estimates.findIndex((x) => x.id === e.id); if (i >= 0) state.estimates[i] = e; else state.estimates.push(e);
      if (!quiet) toast('견적서를 저장했습니다');
    };
    $('#e-save', root).onclick = async () => { await save(); closeSheet(); };
    $('#e-hwp', root).onclick = async () => {
      await save(true);
      if (!e.items.length) { toast('품목을 1개 이상 넣어주세요'); return; }
      if (!(await okToMake('hwpx'))) return;
      try {
        const tpl = (await DB.getKV('template', null)) || await (await fetch('templates/estimate_template.hwpx')).arrayBuffer();
        const b = EstCore.buildTemplateData(e, state.settings.company);
        const stamp = state.settings.company.stamp ? await (await fetch(state.settings.company.stamp)).arrayBuffer() : null;
        const blob = await Hwpx.fillHwpx(tpl, b.data, b.items, { JSZip, DOMParser, XMLSerializer, outType: 'blob', stamp });
        const name = `견적서_${(e.address || e.customer || '고객').replace(/[\\/:*?"<>|]/g, '')}_${e.date}.hwpx`;
        downloadBlob(blob, name); toast('휴대폰에 저장했습니다');
      } catch (err) { console.error(err); alert('견적서 생성 실패: ' + err.message); }
    };
    $('#e-xlsx', root).onclick = async () => {
      await save(true);
      if (!e.items.length) { toast('품목을 1개 이상 넣어주세요'); return; }
      const tpl = await DB.getKV('xlsxTemplate', null);
      if (!tpl || !XlsFill.isXls(tpl)) { if (confirm('사장님 엑셀 견적서 양식(.xls)을 먼저 올려야 합니다. 설정으로 갈까요?')) { closeSheet(); location.hash = 'more'; } return; }
      try {
        const base = `견적서_${(e.address || e.customer || '고객').replace(/[\\/:*?"<>|]/g, '')}_${e.date}`;
        const { file: bytes, warnings } = XlsFill.fillXls(tpl, e, EstCore);
        const file = new Blob([bytes], { type: 'application/vnd.ms-excel' }), name = base + '.xls';
        if (warnings.length) alert(warnings.join('\n'));
        downloadBlob(file, name); toast('휴대폰에 저장했습니다');
      } catch (err) { console.error(err); alert('엑셀 견적서 만들기 실패: ' + err.message); }
    };
    $('#e-print', root).onclick = async () => { await save(true); printEstimate(e); };
    const d = $('#e-del', root);
    if (d) d.onclick = async () => { if (!confirm('견적서를 삭제할까요?')) return; await DB.del('estimates', e.id); state.estimates = state.estimates.filter((x) => x.id !== e.id); closeSheet(); };
    $('[data-close]', root).onclick = closeSheet;
  });
}

function printEstimate(e) {
  const c = state.settings.company;
  const b = EstCore.buildTemplateData(e, c), d = b.data;
  $('#print').innerHTML = `<div class="paper">
    <h1>見　　積　　書</h1>
    <p class="date">${esc(d.year)} 年 ${esc(d.month)} 月 ${esc(d.day)} 日</p>
    <table class="head"><tr>
      <td class="l"><p class="site">${esc(d.site)}</p><p class="u"><b>공사명 : ${esc(d.title)}</b></p>
        <p class="big">貴社에서 依賴하신 見積은<br>아래와 같습니다.</p></td>
      <td class="r"><p class="co">${esc(d.company)}</p>
        <p><b>대　표 : ${esc(d.owner)}</b>${c.stamp ? `<img class="stamp" src="${c.stamp}" alt="">` : ''}</p>
        <p>${esc(d.company_address)}</p>${d.company_tel ? `<p>TEL : ${esc(d.company_tel)}</p>` : ''}${d.company_phone ? `<p>H.P : ${esc(d.company_phone)}</p>` : ''}</td>
    </tr></table>
    <div class="band">合計金額 : ${esc(d.total_korean)}원整　(￦ ${esc(d.total)} )　*부가가치세 ${esc(d.vat_label)}</div>
    <table class="items"><tr><th>NO</th><th>品 名 및 規 格</th><th>單 位</th><th>數 量</th><th>單 價</th><th>金 額</th><th>備 考</th></tr>
    ${b.items.map((it) => `<tr><td>${it.no}</td><td>${esc(it.name)}</td><td>${esc(it.unit)}</td><td>${esc(it.qty)}</td><td>${it.price}</td><td>${it.amount}</td><td>${esc(it.note)}</td></tr>`).join('')}
    <tr><td></td><td>합　　계</td><td></td><td></td><td></td><td><b>${d.total}</b></td><td></td></tr>
    <tr><td colspan="7" class="memo">${esc(d.memo).replace(/\n/g, '<br>')}</td></tr></table></div>`;
  window.print();
}

/* ───────── 돈(미수·통계) ───────── */
function renderMoney(el) {
  const unpaid = state.jobs.filter((j) => unpaidOf(j) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const total = unpaid.reduce((a, j) => a + unpaidOf(j), 0);
  const m = state.moneyMonth;
  const mj = state.jobs.filter((j) => (j.date || '').startsWith(m));
  const sales = mj.reduce((a, j) => a + (Number(j.amount) || 0), 0);
  const got = mj.reduce((a, j) => a + Math.min(Number(j.paid) || 0, Number(j.amount) || 0), 0);
  const byType = {};
  mj.forEach((j) => { const k = j.type || '미분류'; byType[k] = byType[k] || { n: 0, s: 0 }; byType[k].n++; byType[k].s += Number(j.amount) || 0; });
  const today = new Date();
  el.innerHTML = `<h2>받을 돈 <small>${unpaid.length}건</small></h2>
    <div class="stat warn wide"><small>미수금 합계</small><b>${won(total)}원</b></div>
    ${unpaid.map((j) => { const days = Math.floor((today - new Date(j.date + 'T00:00')) / 864e5); return `<div class="card">
      <div class="row"><b>${esc(jobName(j))}</b><b class="red">${won(unpaidOf(j))}원</b></div>
      <div class="sub">${fmtDate(j.date)}${j.type ? ' · ' + esc(j.type) : ''} · ${days > 0 ? `<span class="${days > 30 ? 'red' : ''}">${days}일 지남</span>` : '오늘/예정'}</div>
      <div class="row wrap">
        <button class="btn sm primary" data-pay="${j.id}">입금 확인</button>
        ${j.phone ? `<a class="btn sm" href="tel:${esc(j.phone)}">전화</a><a class="btn sm" href="${esc(smsLink(j))}">문자</a>` : ''}
        <button class="btn sm" data-open="${j.id}">열기</button></div></div>`; }).join('') || '<p class="empty">받을 돈이 없습니다 👍</p>'}
    <h2>월별 정리</h2>
    <label class="inline">월 선택 <input type="month" id="mm" value="${m}"></label>
    <div class="stats"><div class="stat"><small>매출(공사금액)</small><b>${won(sales)}</b></div><div class="stat"><small>받은 돈</small><b>${won(got)}</b></div>
    <div class="stat"><small>작업 건수</small><b>${mj.length}</b></div><div class="stat warn"><small>그 달 미수</small><b>${won(sales - got)}</b></div></div>
    <table class="tbl"><tr><th>종류</th><th>건수</th><th>금액</th></tr>${Object.entries(byType).sort((a, b) => b[1].s - a[1].s).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td class="r">${won(v.s)}</td></tr>`).join('') || '<tr><td colspan="3">기록 없음</td></tr>'}</table>
    <button class="btn" id="csv">⬇ 이 달 장부 엑셀(CSV) 받기</button>`;
  $$('[data-pay]', el).forEach((b) => b.onclick = async () => {
    const j = state.jobs.find((x) => x.id === b.dataset.pay);
    const v = prompt(`${jobName(j)} — 받은 금액을 입력하세요 (남은 금액 ${won(unpaidOf(j))}원)`, won(unpaidOf(j)));
    if (v == null) return; const n = parseMoney(v); if (!n) return;
    j.paid = (Number(j.paid) || 0) + n; j.payDate = ymd();
    if (j.paid >= j.amount) { const c = (j.checklist || []).find((x) => x.t === '입금 확인'); if (c) c.d = true; }
    await DB.put('jobs', j); toast('입금 처리했습니다'); render();
  });
  $$('[data-open]', el).forEach((b) => b.onclick = () => editJob(b.dataset.open));
  $('#mm').onchange = (e) => { state.moneyMonth = e.target.value; render(); };
  $('#csv').onclick = () => {
    const rows = [['날짜', '고객', '연락처', '주소', '종류', '내용', '공사금액', '받은금액', '미수', '결제수단', '입금일']];
    mj.sort((a, b) => a.date.localeCompare(b.date)).forEach((j) => rows.push([j.date, j.customer, j.phone, j.address, j.type, j.desc, j.amount || 0, j.paid || 0, unpaidOf(j), j.payMethod, j.payDate]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `장부_${m}.csv`);
  };
}

/* ───────── 더보기(설정) ───────── */
function renderMore(el) {
  const s = state.settings, c = s.company;
  el.innerHTML = `<h2>설정</h2>
    <details id="cloud-sec" ${Cloud.status.state === 'on' || Cloud.status.state === 'error' ? '' : 'open'}><summary>☁️ 클라우드 저장 (폰 바꿔도 안전)</summary><div id="cloudbox" class="form"></div></details>
    <details><summary>📱 앱으로 설치</summary><div id="installbox"></div></details>
    <details ${c.name ? '' : 'open'}><summary>업체정보 (견적서에 들어감)</summary><form id="cf" class="form">
      <div class="g2"><label>상호<input name="name" value="${esc(c.name)}"></label><label>대표자<input name="owner" value="${esc(c.owner)}"></label></div>
      <div class="g2"><label>사무실 전화 (TEL)<input name="tel" value="${esc(c.tel || '')}" placeholder="(042) 000-0000"></label><label>휴대폰 (H.P)<input name="phone" value="${esc(c.phone)}" placeholder="010-0000-0000"></label></div>
      <label>사업자번호<input name="bizno" value="${esc(c.bizno)}"></label>
      <label>주소<input name="address" value="${esc(c.address)}"></label>
      <label>계좌번호<input name="account" value="${esc(c.account)}" placeholder="○○은행 000-0000-0000 홍길동"></label>
      <div class="stampbox">도장 이미지 <small>(견적서 대표 이름 옆에 찍힘. 흰 종이에 찍어 사진 찍으면 됨)</small><br>
        ${c.stamp ? `<img src="${c.stamp}" alt="도장" class="stamp-prev"> <button type="button" class="btn sm" id="stamp-del">도장 지우기</button>` : ''}
        <label class="btn sm">📷 도장 올리기<input type="file" accept="image/*" hidden id="stamp-in"></label></div>
      <button class="btn primary">저장</button></form></details>
    <details><summary>자주 쓰는 품목 · 단가표 (견적서 빠른 추가)</summary>
      <div id="presets"></div><button class="btn sm" id="padd">＋ 품목</button> <button class="btn sm primary" id="psave">단가표 저장</button></details>
    <details id="op-sec"><summary>누수 소견서 양식 (.hwp)</summary>
      <p class="hint">사장님 소견서 한글 파일(.hwp)을 <b>처음 한 번</b> 올리면, 수리 내역 · 누수 발생 위치 · 누수 발생 원인 · 날짜만 바꾸고 나머지는 그대로 둔 HWP 파일을 만들어 줍니다. 양식은 이 폰과 로그인한 클라우드에만 저장됩니다.</p>
      <p id="optplstate" class="hint"></p>
      <label class="btn">소견서 양식 올리기 (.hwp)<input type="file" accept=".hwp" hidden id="optplin"></label></details>
    <details id="tpl-sec"><summary>견적서 양식 (엑셀 · 한글)</summary>
      <p><b>엑셀 양식</b></p>
      <p class="hint">사장님 엑셀 견적서(<b>.xls</b>)를 <b>처음 한 번</b> 올리면 그 파일 그대로(상호·도장 포함) 칸만 채워서 만들어 줍니다. 양식은 <b>이 폰과 로그인한 클라우드에만</b> 저장되고 인터넷에 공개되지 않습니다. 같은 계정으로 로그인한 다른 폰에도 자동으로 들어갑니다.</p>
      <p id="xtplstate" class="hint"></p>
      <label class="btn">엑셀 양식 올리기 (.xls)<input type="file" accept=".xls" hidden id="xtplin"></label>
      <p style="margin-top:14px"><b>한글 양식</b></p>
      <p class="hint">지금은 <b>예시 양식</b>을 씁니다. 실제 양식으로 바꾸려면: 한글에서 양식을 열고 값이 들어갈 자리에 <code>{{customer}}</code> 처럼 적은 뒤 <b>[다른 이름으로 저장 → HWPX]</b>로 저장해 아래에 올리세요. 품목 표는 한 줄에 <code>{{name}}</code> 등을 적어두면 품목 수만큼 늘어납니다.</p>
      <p class="hint">쓸 수 있는 자리표시자: <code>{{date}} {{customer}} {{phone}} {{address}} {{title}} {{memo}} {{company}} {{owner}} {{bizno}} {{company_phone}} {{company_address}} {{account}} {{supply}} {{vat}} {{total}} {{total_korean}}</code> / 품목 행: <code>{{no}} {{name}} {{spec}} {{qty}} {{unit}} {{price}} {{amount}} {{note}}</code> (한글 이름 {{고객}} {{품명}} 등도 됨)</p>
      <p id="tplstate" class="hint"></p>
      <label class="btn">양식 올리기 (.hwpx)<input type="file" accept=".hwpx" hidden id="tplin"></label>
      <a class="btn" href="templates/estimate_template.hwpx" download="견적서_예시양식.hwpx">예시 양식 받기</a>
      <button class="btn" id="tplreset">예시 양식으로 되돌리기</button></details>
    <details id="imp-sec"><summary>📥 지난 작업 메모 가져오기</summary><div class="form">
      <p class="hint">날짜별로 적어 둔 메모 파일(.html / .txt)을 올리거나 글을 붙여넣으면, 날짜마다 달력 기록으로 넣어 줍니다. 날짜 줄 모양: <code>3/24</code>, <code>2023년 12월 18일</code>, <code>2025 11월 17일</code> · 한 번에 1년치 파일도 됩니다</p>
      <label class="btn sm">📄 메모 파일 고르기<input type="file" accept=".html,.htm,.txt,text/plain,text/html" hidden id="impfile"></label>
      <label>또는 붙여넣기<textarea id="imptext" rows="4" placeholder="3/24&#10;드리움 스크린죠 13&#10;누수 40 300평집"></textarea></label>
      <div class="g2"><label>첫 연도 <small>(메모에 연도가 없을 때)</small><input id="impyear" type="number" inputmode="numeric"></label>
      <label>넣을 달<select id="impmonth"><option value="">전체</option></select></label></div>
      <p class="hint" id="impinfo"></p>
      <button class="btn primary" id="impgo" disabled>가져오기</button>
      <div class="impclear"><b>잘못 들어간 기록 지우기</b>
        <p class="hint">메모 가져오기로 넣은 기록만 지웁니다. 앱에서 직접 쓴 기록은 그대로 남습니다.</p>
        <div class="row"><select id="impdelyear"></select><button class="btn danger" id="impdel">지우기</button></div></div></div></details>
    <details><summary>고객 목록</summary><div id="custs"></div></details>
    <details><summary>백업 · 복원 (중요)</summary>
      <p class="hint">클라우드 저장을 켜면 자동으로 안전하게 보관됩니다. 이 백업 파일은 추가 보험용입니다(클라우드를 안 쓸 때는 꼭 주기적으로 받아두세요).</p>
      <label class="chk"><input type="checkbox" id="bkph" checked> 사진 포함</label>
      <button class="btn primary" id="bk">⬇ 백업 받기</button>
      <label class="btn">⬆ 백업 복원<input type="file" accept=".json" hidden id="rs"></label></details>
    <p class="hint">배관·누수 업무수첩 v2 · 클라우드를 켜지 않으면 데이터는 이 기기 밖으로 나가지 않습니다.</p>`;
  $('#cf').onsubmit = async (e) => { e.preventDefault(); for (const k of Object.keys(c)) if (e.target[k]) c[k] = e.target[k].value.trim(); await saveSettings(); toast('업체정보 저장'); };
  $('#stamp-in').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const form = $('#cf'); for (const k of Object.keys(c)) if (form[k]) c[k] = form[k].value.trim(); // 적던 내용 같이 저장
    c.stamp = await stampImage(f); await saveSettings(); toast('도장을 저장했습니다'); render();
  };
  const sd = $('#stamp-del'); if (sd) sd.onclick = async () => { const form = $('#cf'); for (const k of Object.keys(c)) if (form[k]) c[k] = form[k].value.trim(); c.stamp = ''; await saveSettings(); render(); };
  const drawPresets = () => {
    $('#presets').innerHTML = s.presets.map((p, i) => `<div class="item" data-i="${i}"><input data-k="name" value="${esc(p.name)}" placeholder="품명" class="w-name"><input data-k="spec" value="${esc(p.spec)}" placeholder="규격" class="w-s"><input data-k="unit" value="${esc(p.unit)}" placeholder="단위" class="w-s"><input data-k="price" value="${won(p.price)}" placeholder="단가" class="w-m" inputmode="numeric"><button class="x" data-pdel="${i}">×</button></div>`).join('');
    $$('#presets input').forEach((inp) => inp.onchange = () => { const p = s.presets[inp.closest('.item').dataset.i]; p[inp.dataset.k] = inp.dataset.k === 'price' ? parseMoney(inp.value) || 0 : inp.value; });
    $$('#presets [data-pdel]').forEach((b) => b.onclick = () => { s.presets.splice(b.dataset.pdel, 1); drawPresets(); });
  };
  drawPresets();
  $('#padd').onclick = () => { s.presets.push({ name: '', spec: '', unit: '식', price: 0 }); drawPresets(); };
  $('#psave').onclick = async () => { s.presets = s.presets.filter((p) => p.name); await saveSettings(); toast('단가표 저장'); drawPresets(); };
  DB.getKV('templateName', '').then((n) => { $('#tplstate').textContent = n ? `사용 중인 양식: ${n}` : '사용 중인 양식: 예시 양식'; });
  $('#tplin').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    try {
      const z = await JSZip.loadAsync(buf);
      if (!z.file('Contents/section0.xml')) throw new Error('HWPX 형식이 아닙니다 (한글에서 HWPX로 저장했는지 확인)');
      const x = await z.file('Contents/section0.xml').async('string');
      const keys = [...new Set((x.match(/\{\{[^}<]+\}\}/g) || []))];
      await DB.setKV('template', buf); await DB.setKV('templateName', f.name);
      if (Cloud.ready) await Cloud.pushTemplate(buf, f.name);
      s.templateName = f.name; await saveSettings();
      alert(`양식을 등록했습니다.\n찾은 자리표시자 ${keys.length}개: ${keys.join(' ') || '(없음 — 글자가 쪼개져 저장됐을 수 있습니다)'}`);
      render();
    } catch (err) { alert('양식 등록 실패: ' + err.message); }
  };
  DB.getKV('xlsxTemplateName', '').then((n) => {
    const ok = /\.xls$/i.test(n || '');
    $('#xtplstate').innerHTML = ok ? `✅ 사용 중인 엑셀 양식: ${esc(n)} ${Cloud.ready ? '(클라우드에 보관됨)' : '(이 폰에만 있음 — 클라우드에 로그인하면 자동 보관)'}`
      : '<span class="red">⚠️ 엑셀 견적서 양식(.xls)이 아직 없습니다 → 아래 [엑셀 양식 올리기]</span>';
    if (!ok) $('#tpl-sec').open = true;
  });

  $('#xtplin').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    try {
      if (!XlsFill.isXls(buf)) throw new Error('.xls 파일만 올릴 수 있습니다');
      const chk = XlsFill.checkXlsTemplate(buf); if (!chk.ok) throw new Error(chk.why);
      await DB.setKV('xlsxTemplate', buf); await DB.setKV('xlsxTemplateName', f.name);
      if (Cloud.ready) await Cloud.pushTemplate(buf, f.name, 'xlsx');
      s.xlsxTemplateName = f.name; await saveSettings();
      alert('엑셀 양식을 등록했습니다. 견적서에서 [엑셀 받기]로 확인해 보세요.'); render();
    } catch (err) { alert('엑셀 양식 등록 실패: ' + err.message); }
  };
  DB.getKV('opinionTemplateName', '').then((n) => {
    $('#optplstate').innerHTML = n ? `✅ 사용 중인 소견서 양식: ${esc(n)} ${Cloud.ready ? '(클라우드에 보관됨)' : '(이 폰에만 있음 — 클라우드에 로그인하면 자동 보관)'}` : '<span class="red">⚠️ 소견서 양식이 아직 없습니다 → 아래 [소견서 양식 올리기]</span>';
    if (!n) $('#op-sec').open = true;
  });
  $('#optplin').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    try {
      const chk = Hwp5.checkOpinionTemplate(buf);
      if (!chk.ok) throw new Error(chk.why);
      await DB.setKV('opinionTemplate', buf); await DB.setKV('opinionTemplateName', f.name);
      if (Cloud.ready) await Cloud.pushTemplate(buf, f.name, 'hwp');
      s.opinionTemplateName = f.name; await saveSettings();
      alert('소견서 양식을 등록했습니다.'); render();
    } catch (err) { alert('소견서 양식 등록 실패: ' + (/header|CFB|signature|Unsupported|corrupt/i.test(err.message) ? '한글(.hwp) 파일이 아닙니다. (.hwpx 는 안 됩니다)' : err.message)); }
  };
  $('#tplreset').onclick = async () => { await DB.del('kv', 'template'); await DB.del('kv', 'templateName'); s.templateName = ''; await saveSettings(); toast('예시 양식으로 되돌렸습니다'); render(); };
  const cm = new Map();
  state.jobs.forEach((j) => { if (!j.customer) return; const k = j.customer + '|' + (j.phone || ''); const v = cm.get(k) || { name: j.customer, phone: j.phone, n: 0, s: 0, u: 0, last: '' }; v.n++; v.s += Number(j.amount) || 0; v.u += unpaidOf(j); if (j.date > v.last) v.last = j.date; cm.set(k, v); });
  $('#custs').innerHTML = `<table class="tbl"><tr><th>고객</th><th>횟수</th><th>총액</th><th>미수</th><th>최근</th></tr>${[...cm.values()].sort((a, b) => b.last.localeCompare(a.last)).map((v) => `<tr><td>${esc(v.name)}<br><small>${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</small></td><td>${v.n}</td><td class="r">${won(v.s)}</td><td class="r ${v.u ? 'red' : ''}">${won(v.u)}</td><td>${fmtDate(v.last)}</td></tr>`).join('') || '<tr><td colspan="5">작업 기록이 쌓이면 자동으로 만들어집니다</td></tr>'}</table>`;
  drawCloud(); drawInstall();
  setupImport();
  $('#bk').onclick = backup;
  $('#rs').onchange = restore;
}

/* ───────── 클라우드 화면 ───────── */
const fmtTime = (iso) => { if (!iso) return '없음'; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function drawCloudBadge() {
  const b = $('#cloudbtn'); if (!b) return;
  const st = Cloud.status.state;
  b.textContent = { off: '', login: '로그인 필요', syncing: '동기화 중…', on: '● 저장됨', error: '동기화 오류' }[st] || '';
  b.className = 'cloud ' + st;
}
function drawCloud() {
  const box = $('#cloudbox'); if (!box) return;
  const c = Cloud.config(), st = Cloud.status;
  if (st.state === 'off') {
    box.innerHTML = `<p class="hint">Supabase(무료 클라우드)에 저장합니다. 처음 한 번 설정이 필요합니다 → <b>친구용_설정안내.md</b> 1~2단계.</p>
      <label>Supabase 주소<input id="c-url" value="${esc(c.supabaseUrl)}" placeholder="https://xxxx.supabase.co"></label>
      <label>공개 키 (anon / publishable)<input id="c-key" value="${esc(c.supabaseAnonKey)}"></label>
      <button class="btn primary" id="c-save">연결</button>`;
    $('#c-save').onclick = async () => {
      const ok = await Cloud.saveConfig({ ...c, supabaseUrl: $('#c-url').value.trim().replace(/\/$/, ''), supabaseAnonKey: $('#c-key').value.trim() });
      if (Cloud.status.state === 'off') toast('주소나 키를 확인하세요'); else if (!ok) toast('이제 로그인하세요');
      drawCloud();
    };
    return;
  }
  if (st.state === 'login') {
    box.innerHTML = `<p class="hint">이 이메일·비밀번호로 어느 폰에서든 같은 기록을 봅니다.</p>
      <label>이메일<input id="c-email" type="email" autocomplete="username"></label>
      <label>비밀번호 (6자 이상)<input id="c-pw" type="password" autocomplete="current-password"></label>
      <div class="row wrap"><button class="btn primary" id="c-in">로그인</button><button class="btn" id="c-up">처음이면 가입</button><button class="btn sm" id="c-reset">연결 정보 바꾸기</button></div>`;
    const go = async (fn) => {
      const e = $('#c-email').value.trim(), p = $('#c-pw').value;
      if (!e || p.length < 6) { toast('이메일과 6자 이상 비밀번호를 넣으세요'); return; }
      try {
        if (fn === 'up') { const r = await Cloud.signUp(e, p); if (r === 'confirm') { alert('메일함에서 가입 확인 링크를 누른 뒤 로그인하세요.'); return; } await Cloud.sync({ full: true }); }
        else await Cloud.signIn(e, p);
        await loadAll(); toast('로그인 완료. 기록을 맞췄습니다'); render();
      } catch (err) { alert('실패: ' + err.message); }
    };
    $('#c-in').onclick = () => go('in'); $('#c-up').onclick = () => go('up');
    $('#c-reset').onclick = async () => { await Cloud.saveConfig({ ...c, supabaseUrl: '', supabaseAnonKey: '' }); drawCloud(); };
    return;
  }
  box.innerHTML = `<p>✅ <b>${esc(Cloud.user?.email || '')}</b> 로 저장 중</p>
    <p class="hint">마지막 동기화: ${fmtTime(st.lastSync)} ${st.state === 'error' ? `<br><span class="red">오류: ${esc(st.error)}</span>` : ''}</p>
    <p class="hint">저장하면 몇 초 안에 자동으로 올라가고, 인터넷이 끊기면 다시 연결될 때 올라갑니다.</p>
    <div class="row wrap"><button class="btn primary" id="c-sync">지금 동기화</button><button class="btn" id="c-out">로그아웃</button></div>`;
  $('#c-sync').onclick = async () => { const r = await Cloud.sync(); if (r.error) toast('동기화 실패'); else { await loadAll(); toast('동기화 완료'); render(); } };
  $('#c-out').onclick = async () => { if (confirm('로그아웃할까요? 이 폰의 기록은 그대로 남습니다.')) { await Cloud.signOut(); render(); } };
}

const kakaoRedirect = () => location.origin + location.pathname;
async function drawKakao() {
  const box = $('#kakaobox'); if (!box) return;
  const n = state.settings.notify || { enabled: true, days: 7 };
  if (!Cloud.ready) { box.innerHTML = '<p class="hint">먼저 위의 클라우드 저장에 로그인하세요. (알림은 서버가 매일 클라우드 기록을 보고 보냅니다)</p>'; return; }
  let ks = null, err = '';
  try { ks = await Cloud.kakaoStatus(); } catch (e) { err = e.message; }
  box.innerHTML = `<p class="hint">작업일로부터 정한 날짜가 지났는데 돈을 다 못 받은 작업을 <b>매일 오전 9시</b>에 내 카톡(나와의 채팅)으로 보냅니다. 미수가 없으면 보내지 않습니다.</p>
    ${err ? `<p class="red hint">상태 확인 실패: ${esc(err)} (설정안내 1단계 SQL 실행 확인)</p>` : ''}
    <p>${ks?.connected ? `✅ 카카오 연결됨 <small class="hint">(재연결 필요일: ${ks.refresh_expires_at ? fmtDate(ks.refresh_expires_at.slice(0, 10)) : '-'})</small>` : '❌ 카카오 연결 안 됨'}</p>
    ${ks?.last_sent_at ? `<p class="hint">마지막 확인: ${fmtTime(ks.last_sent_at)} — ${esc(ks.last_result || '')}</p>` : ''}
    <label class="chk"><input type="checkbox" id="k-on" ${n.enabled !== false ? 'checked' : ''}> 알림 받기</label>
    <label class="inline">며칠 지나면 알릴까요 <input type="number" id="k-days" min="1" max="90" value="${Number(n.days) || 7}" style="width:80px">일</label>
    <div class="row wrap">
      <button class="btn primary" id="k-conn">${ks?.connected ? '카카오 다시 연결' : '카카오 연결'}</button>
      ${ks?.connected ? '<button class="btn" id="k-test">지금 테스트 발송</button><button class="btn danger" id="k-off">연결 끊기</button>' : ''}
    </div>
    <p class="hint">카카오 디벨로퍼스에 등록할 Redirect URI: <code>${esc(kakaoRedirect())}</code></p>`;
  const saveN = async () => { state.settings.notify = { enabled: $('#k-on').checked, days: Math.max(1, Number($('#k-days').value) || 7) }; await saveSettings(); toast('알림 설정 저장'); };
  $('#k-on').onchange = saveN; $('#k-days').onchange = saveN;
  $('#k-conn').onclick = () => {
    const key = Cloud.config().kakaoRestKey || prompt('카카오 REST API 키를 입력하세요 (설정안내 3단계)');
    if (!key) return;
    if (!Cloud.config().kakaoRestKey) Cloud.saveConfig({ ...Cloud.config(), kakaoRestKey: key.trim() });
    location.href = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(key.trim())}&redirect_uri=${encodeURIComponent(kakaoRedirect())}&scope=talk_message&state=kakao`;
  };
  const t = $('#k-test');
  if (t) t.onclick = async () => {
    t.disabled = true; t.textContent = '보내는 중…';
    try { await Cloud.sync(); const r = await Cloud.invoke('kakao-notify', { mode: 'test' }); alert('결과: ' + (r.result || 'OK') + '\n카톡 "나와의 채팅"을 확인하세요.'); }
    catch (e) { alert('발송 실패: ' + e.message); }
    drawKakao();
  };
  const off = $('#k-off');
  if (off) off.onclick = async () => { if (!confirm('카카오 알림 연결을 끊을까요?')) return; await Cloud.rpcDisconnect(); drawKakao(); };
}

// 카카오 로그인 후 돌아왔을 때 (?code=...&state=kakao)
async function handleKakaoReturn() {
  const q = new URLSearchParams(location.search);
  if (q.get('state') !== 'kakao' || !(q.get('code') || q.get('error'))) return;
  history.replaceState(null, '', location.pathname + '#more');
  if (q.get('error')) { alert('카카오 연결 취소/실패: ' + (q.get('error_description') || q.get('error'))); return; }
  if (!Cloud.ready) { alert('클라우드 로그인 후 다시 연결하세요'); return; }
  try { await Cloud.invoke('kakao-auth', { code: q.get('code'), redirect_uri: kakaoRedirect() }); toast('카카오 연결 완료! 테스트 발송을 눌러보세요'); }
  catch (e) { alert('카카오 연결 실패: ' + e.message); }
  render();
}

// 카톡 등에서 [공유] → 업무수첩 으로 보낸 글 받기 (안드로이드에 설치한 경우)
function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  if (q.get('state') === 'kakao' || !(q.has('text') || q.has('title') || q.has('url'))) return;
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
  history.replaceState(null, '', location.pathname + '#est');
  render();
  if (!text) return;
  editEstimate(null);
  $('#raw').value = text;
  toast('받은 글을 넣었습니다. [자동 채우기]를 누르세요');
}

/* ───────── 앱 설치 ───────── */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (route() === 'more' || route() === 'home') render(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('앱으로 설치했습니다. 홈 화면에서 여세요'); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installHTML() {
  if (isStandalone()) return '<p>✅ 앱으로 실행 중입니다.</p>';
  if (installEvt) return '<button class="btn primary big" id="do-install">📲 홈 화면에 앱 설치</button>';
  if (isIOS()) return '<p class="hint"><b>아이폰:</b> Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b> → 추가. (Safari에서만 됩니다)</p>';
  return '<p class="hint"><b>안드로이드:</b> Chrome 오른쪽 위 <b>⋮ 메뉴</b> → <b>앱 설치</b>(또는 홈 화면에 추가). 삼성 인터넷은 메뉴 → <b>현재 페이지 추가 → 홈 화면</b>.</p>';
}
function drawInstall() {
  const box = $('#installbox'); if (!box) return;
  box.innerHTML = installHTML() + '<p class="hint">설치하면 주소창 없이 앱처럼 열리고, 인터넷이 없어도 켜집니다.</p>';
  const b = $('#do-install', box);
  if (b) b.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
}

function setupImport() {
  let parsed = [];
  const text = () => $('#imptext').value;
  const refresh = () => {
    const t = text();
    if (!t.trim()) { parsed = []; $('#impinfo').textContent = ''; $('#impgo').disabled = true; return; }
    if (!$('#impyear').value) $('#impyear').value = MemoImport.guessYear(t) || new Date().getFullYear();
    parsed = MemoImport.parseMemo(t, Number($('#impyear').value));
    const months = {}; parsed.forEach((e) => { const k = e.date.slice(0, 7); months[k] = (months[k] || 0) + 1; });
    const cur = $('#impmonth').value;
    $('#impmonth').innerHTML = `<option value="">전체 (${parsed.length}일)</option>` + Object.entries(months).map(([k, n]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${k.slice(0, 4)}년 ${Number(k.slice(5))}월 (${n}일)</option>`).join('');
    const pick = parsed.filter((e) => !$('#impmonth').value || e.date.startsWith($('#impmonth').value));
    const big = MemoImport.suspicious(pick);
    $('#impinfo').innerHTML = pick.length ? `넣을 날짜 <b>${pick.length}일</b>: ${pick[0].date} ~ ${pick[pick.length - 1].date} · 하루 최대 ${Math.max(...pick.map((e) => e.lines.length))}줄<br>예) ${esc(pick[0].date)} — ${esc(pick[0].lines.slice(0, 2).join(' / '))}`
      + (big.length ? `<br><span class="red">⚠️ 줄이 너무 많은 날: ${big.map((e) => `${e.date}(${e.lines.length}줄)`).join(', ')} — 날짜 줄 모양이 달라 여러 날이 한 날에 몰렸을 수 있습니다. 관리자에게 메모를 보내 확인하세요.</span>` : '')
      : '날짜 줄을 찾지 못했습니다 (예: 3/24, 2025년 1월 3일)';
    $('#impgo').disabled = !pick.length;
  };
  const fillDel = () => {
    const memo = state.jobs.filter((j) => j.src === 'memo'), ys = {};
    memo.forEach((j) => { const y = (j.date || '').slice(0, 4); ys[y] = (ys[y] || 0) + 1; });
    $('#impdelyear').innerHTML = `<option value="">전체 (${memo.length}건)</option>` + Object.keys(ys).sort().map((y) => `<option value="${y}">${y}년 (${ys[y]}건)</option>`).join('');
    $('#impdel').disabled = !memo.length;
  };
  fillDel();
  $('#impdel').onclick = async () => {
    const y = $('#impdelyear').value;
    const del = state.jobs.filter((j) => j.src === 'memo' && (!y || (j.date || '').startsWith(y)));
    if (!del.length) return;
    if (!confirm(`메모로 가져온 기록 ${del.length}건(${y ? y + '년' : '전체'})을 지울까요?\n직접 쓴 기록은 지워지지 않습니다.\n지운 뒤에는 되돌릴 수 없으니, 메모 파일을 다시 가져오면 됩니다.`)) return;
    for (const j of del) await DB.del('jobs', j.id);
    const ids = new Set(del.map((j) => j.id)); state.jobs = state.jobs.filter((j) => !ids.has(j.id));
    fillDel(); alert(`${del.length}건 지웠습니다. 이제 메모 파일을 다시 가져오세요.`);
  };
  $('#impfile').onchange = async (ev) => { const f = ev.target.files[0]; if (!f) return; $('#imptext').value = await f.text(); $('#impyear').value = ''; refresh(); };
  $('#imptext').oninput = refresh; $('#impyear').oninput = refresh; $('#impmonth').onchange = refresh;
  $('#impgo').onclick = async () => {
    const pick = parsed.filter((e) => !$('#impmonth').value || e.date.startsWith($('#impmonth').value));
    if (!pick.length || !confirm(`${pick.length}일치 기록을 달력에 넣을까요?\n(전에 메모로 가져온 날은 새 내용으로 바꾸고, 직접 쓴 기록은 그대로 둡니다)`)) return;
    let added = 0, skipped = 0, updated = 0;
    for (const e of pick) {
      const desc = e.lines.join('\n');
      if (state.jobs.some((j) => j.date === e.date && (j.desc || '').trim() === desc.trim())) { skipped++; continue; }
      // 전에 메모로 가져온 같은 날 기록 → 새 내용으로 교체 (같은 날 두 번 들어가지 않게)
      const old = state.jobs.filter((j) => j.date === e.date && j.src === 'memo');
      if (old.length) {
        old[0].desc = desc; await DB.put('jobs', old[0]);
        for (const x of old.slice(1)) { await DB.del('jobs', x.id); state.jobs = state.jobs.filter((j) => j !== x); }
        updated++; continue;
      }
      const j = { id: uid(), date: e.date, desc, customer: '', phone: '', address: '', type: '', time: '', amount: 0, paid: 0, photos: [], checklist: [], memo: '', status: 'done', src: 'memo' };
      await DB.put('jobs', j); state.jobs.push(j); added++;
    }
    fillDel();
    alert(`${added}일 넣었습니다${updated ? `, ${updated}일은 새 내용으로 바꿈` : ''}${skipped ? ` (같은 내용 ${skipped}일은 건너뜀)` : ''}.`);
    state.calSel = pick[0].date; state.calMonth = new Date(pick[0].date + 'T00:00'); location.hash = 'cal';
  };
}

function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// 도장 사진 → 흰 바탕을 투명하게 만든 작은 PNG (dataURL)
async function stampImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const r = Math.min(1, 300 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
    const px = g.getImageData(0, 0, cv.width, cv.height), a = px.data;
    for (let k = 0; k < a.length; k += 4) { const m = Math.min(a[k], a[k + 1], a[k + 2]); if (m > 200) a[k + 3] = Math.max(0, Math.round((255 - m) * 255 / 55)); }
    g.putImageData(px, 0, 0);
    return cv.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
const blobToDataURL = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function backup() {
  const out = { app: 'plumbing-biz', v: 1, at: new Date().toISOString(), settings: state.settings, jobs: state.jobs, todos: state.todos, estimates: state.estimates, photos: [] };
  if ($('#bkph').checked) for (const p of await DB.all('photos')) out.photos.push({ id: p.id, jobId: p.jobId, data: await blobToDataURL(p.blob) });
  downloadBlob(new Blob([JSON.stringify(out)], { type: 'application/json' }), `업무수첩_백업_${ymd()}.json`);
}
async function restore(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'plumbing-biz') throw new Error('이 앱의 백업 파일이 아닙니다');
    if (!confirm(`백업(${d.at?.slice(0, 10)})으로 덮어쓸까요? 지금 기록은 사라집니다.${Cloud.ready ? '\n(클라우드에만 있는 기록은 다음 동기화 때 다시 내려옵니다)' : ''}`)) return;
    for (const s of ['jobs', 'todos', 'estimates', 'photos']) await DB.clear(s);
    for (const j of d.jobs || []) await DB.put('jobs', j);
    for (const t of d.todos || []) await DB.put('todos', t);
    for (const x of d.estimates || []) await DB.put('estimates', x);
    for (const p of d.photos || []) await DB.put('photos', { id: p.id, jobId: p.jobId, blob: await (await fetch(p.data)).blob() });
    if (d.settings) await DB.setKV('settings', d.settings);
    await loadAll(); toast('복원 완료'); render();
  } catch (err) { alert('복원 실패: ' + err.message); }
}

/* ───────── 시작 ───────── */
window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', async () => {
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  await loadAll();
  render();
  // 클라우드 연결
  Cloud.onStatus(() => { drawCloudBadge(); if (route() === 'more' && !$('#sheet').classList.contains('open')) drawCloud(); });
  DB.onChange(() => Cloud.scheduleSync());
  Cloud.onRemoteChange = async () => { await loadAll(); if (!$('#sheet').classList.contains('open')) render(); };
  drawCloudBadge();
  if (await Cloud.init()) {
    await handleKakaoReturn();
    const r = await Cloud.sync(); if (r.changed) await Cloud.onRemoteChange();
  } else if (location.search.includes('state=kakao')) await handleKakaoReturn();
  handleShareTarget();
  window.addEventListener('online', () => Cloud.sync().then((r) => r.changed && Cloud.onRemoteChange()));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Cloud.sync().then((r) => r.changed && Cloud.onRemoteChange()); });
  setInterval(() => { if (!document.hidden) Cloud.sync().then((r) => r.changed && Cloud.onRemoteChange()); }, 5 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
});
