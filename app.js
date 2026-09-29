const SUBJECTS = [
  { id: 'korean', name: '국어', icon: '📖', color: 'pink', file: 'data/korean.csv' },
  { id: 'english', name: '영어', icon: '🌷', color: 'sky', file: 'data/english.csv' },
  { id: 'admin_law', name: '행정법', icon: '⚖️', color: 'mint', file: 'data/admin_law.csv' },
  { id: 'education', name: '교육학', icon: '🍎', color: 'lemon', file: 'data/education.csv' },
];
const USER_NAME = '구나연';
const QUESTIONS_PER_ROUND = 25;
const RECENT_ROUNDS = 2; // 최근 몇 회차에 나온 문제를 뒤로 미룰지
const HISTORY_MAX = 100;
const MARKS = ['①', '②', '③', '④'];

const $ = (id) => document.getElementById(id);
const banks = {};   // subject id -> [{q, choices, answer, exp}]
let state = null;   // current round

// ---------- CSV ----------

// 따옴표 안의 쉼표·줄바꿈을 지원하는 CSV 파서
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 엑셀(한국어 윈도우)에서 저장한 CSV는 CP949인 경우가 많아 UTF-8 실패 시 EUC-KR로 다시 읽음
function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

function toAnswerIndex(value, choices) {
  const v = value.trim();
  const mark = MARKS.indexOf(v);
  if (mark >= 0) return mark;
  const n = parseInt(v, 10);
  if (n >= 1 && n <= 4) return n - 1;
  const byText = choices.findIndex((c) => c === v);
  return byText; // -1이면 잘못된 행
}

function buildBank(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''))
    .filter((r) => r.some((f) => f.trim() !== ''));
  if (rows.length && /문제|question/i.test(rows[0][0])) rows.shift(); // 머리글 행
  const bank = [];
  for (const r of rows) {
    const [q, c1, c2, c3, c4, ans, exp = ''] = r.map((f) => (f ?? '').trim());
    const choices = [c1, c2, c3, c4];
    if (!q || choices.some((c) => !c) || !ans) continue;
    const answer = toAnswerIndex(ans, choices);
    if (answer < 0) continue;
    bank.push({ q, choices, answer, exp });
  }
  return bank;
}

// ---------- 저장소 (직접 불러온 CSV) ----------

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

async function loadBank(subject) {
  const custom = storageGet('bank:' + subject.id);
  if (custom) {
    banks[subject.id] = { list: buildBank(custom), custom: true };
    return;
  }
  try {
    const res = await fetch(subject.file, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    banks[subject.id] = { list: buildBank(decode(await res.arrayBuffer())), custom: false };
  } catch {
    banks[subject.id] = { list: [], custom: false, error: true };
  }
}

function loadJSON(key, fallback) {
  try { return JSON.parse(storageGet(key)) ?? fallback; } catch { return fallback; }
}
const saveJSON = (key, value) => storageSet(key, JSON.stringify(value));
const keyOf = (item) => item.q + '\u0001' + item.choices.join('\u0001');

// 오답노트: 문제 키 -> 틀린 횟수. 다시 맞히면 빠짐
const getWrongNote = (id) => loadJSON('wrong:' + id, {});
function wrongNoteItems(id) {
  const note = getWrongNote(id);
  return banks[id].list.filter((it) => note[keyOf(it)]);
}

// ---------- 화면 ----------

function show(screen) {
  for (const id of ['home', 'quiz', 'result', 'history']) $(id).classList.toggle('hidden', id !== screen);
  window.scrollTo(0, 0);
}

function renderHome() {
  $('title').textContent = `${USER_NAME}님의 문제풀이`;
  const box = $('subjects');
  box.innerHTML = '';
  for (const s of SUBJECTS) {
    const b = banks[s.id];
    const btn = document.createElement('button');
    btn.className = 'subject ' + s.color;
    const info = b.error ? '문제 파일을 못 읽음'
      : `${b.list.length}문제${b.custom ? ' · 직접 불러옴' : ''}`;
    btn.innerHTML = `<i>${s.icon}</i><b>${s.name}</b><span>${info}</span>`;
    btn.disabled = b.list.length === 0;
    btn.onclick = () => startRound(s, 'normal');
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.appendChild(btn);
    const wrongCount = b.list.length ? wrongNoteItems(s.id).length : 0;
    const note = document.createElement('button');
    note.className = 'note';
    note.textContent = `오답노트 ${wrongCount}문제 풀기`;
    note.disabled = wrongCount === 0;
    note.onclick = () => startRound(s, 'wrong');
    card.appendChild(note);
    box.appendChild(card);
  }

  const up = $('uploads');
  up.innerHTML = '';
  for (const s of SUBJECTS) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML = `<b>${s.name}</b><input type="file" accept=".csv,text/csv">`;
    row.querySelector('input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = decode(await file.arrayBuffer());
      const bank = buildBank(text);
      if (!bank.length) { alert('읽을 수 있는 문제가 없습니다. CSV 형식을 확인해 주세요.'); return; }
      if (!storageSet('bank:' + s.id, text)) alert('이 브라우저에 저장하지 못했습니다. 이번 접속에서만 사용됩니다.');
      banks[s.id] = { list: bank, custom: true };
      alert(`${s.name} ${bank.length}문제를 불러왔습니다.`);
      renderHome();
    };
    if (banks[s.id].custom) {
      const reset = document.createElement('button');
      reset.textContent = '기본으로 되돌리기';
      reset.onclick = async () => { storageSet('bank:' + s.id, null); await loadBank(s); renderHome(); };
      row.appendChild(reset);
    }
    up.appendChild(row);
  }
}

// ---------- 문제 풀이 ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(subject, mode) {
  if (mode === 'wrong') return shuffle(wrongNoteItems(subject.id)).slice(0, QUESTIONS_PER_ROUND);
  // 최근 회차에 안 나온 문제를 먼저, 모자라면 최근 문제로 채움.
  // 각 문제는 한 번만 들어가므로 한 회차 안에서는 겹치지 않음
  const recent = new Set(loadJSON('recent:' + subject.id, []).flat());
  const list = banks[subject.id].list;
  const fresh = list.filter((it) => !recent.has(keyOf(it)));
  const seen = list.filter((it) => recent.has(keyOf(it)));
  return [...shuffle(fresh), ...shuffle(seen)].slice(0, QUESTIONS_PER_ROUND);
}

function startRound(subject, mode = 'normal') {
  const questions = pickQuestions(subject, mode);
  if (!questions.length) { show('home'); renderHome(); return; }
  state = { subject, mode, questions, index: 0, selected: null, submitted: false, correct: 0, wrong: [] };
  show('quiz');
  renderQuestion();
}

function renderQuestion() {
  const { questions, index } = state;
  const item = questions[index];
  state.selected = null;
  state.submitted = false;

  $('progress').textContent = `${index + 1} / ${questions.length}`;
  $('liveScore').textContent = `맞음 ${state.correct}`;
  $('barFill').style.width = `${(index / questions.length) * 100}%`;
  $('question').textContent = `${index + 1}. ${item.q}`;

  const box = $('choices');
  box.innerHTML = '';
  item.choices.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.innerHTML = `<span class="num">${MARKS[i]}</span><span></span>`;
    btn.lastChild.textContent = text;
    btn.onclick = () => {
      if (state.submitted) return;
      state.selected = i;
      [...box.children].forEach((c, k) => c.classList.toggle('selected', k === i));
      $('actionBtn').disabled = false;
    };
    box.appendChild(btn);
  });

  $('feedback').className = 'feedback hidden';
  const action = $('actionBtn');
  action.textContent = '제출';
  action.disabled = true;
}

function submit() {
  const item = state.questions[state.index];
  const ok = state.selected === item.answer;
  state.submitted = true;
  const note = getWrongNote(state.subject.id);
  if (ok) {
    state.correct++;
    delete note[keyOf(item)];
  } else {
    state.wrong.push({ ...item, mine: state.selected });
    note[keyOf(item)] = (note[keyOf(item)] || 0) + 1;
  }
  saveJSON('wrong:' + state.subject.id, note);

  [...$('choices').children].forEach((c, k) => {
    c.classList.remove('selected');
    if (k === item.answer) c.classList.add('correct');
    else if (k === state.selected) c.classList.add('wrong');
  });

  const fb = $('feedback');
  fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
  fb.innerHTML = `<span class="verdict"></span><span class="exp"></span>`;
  fb.firstChild.textContent = ok ? '정답입니다' : `오답입니다 · 정답 ${MARKS[item.answer]}`;
  fb.lastChild.textContent = item.exp || '(해설 없음)';

  $('liveScore').textContent = `맞음 ${state.correct}`;
  $('actionBtn').textContent = state.index + 1 < state.questions.length ? '다음 문제' : '결과 보기';
}

function next() {
  state.index++;
  if (state.index < state.questions.length) renderQuestion();
  else renderResult();
}

function saveRound() {
  const id = state.subject.id;
  const total = state.questions.length;
  if (state.mode === 'normal') {
    const recent = loadJSON('recent:' + id, []);
    recent.push(state.questions.map(keyOf));
    saveJSON('recent:' + id, recent.slice(-RECENT_ROUNDS));
  }
  const history = loadJSON('history:' + id, []);
  history.push({
    date: new Date().toISOString(),
    mode: state.mode,
    correct: state.correct,
    total,
    score: Math.round((state.correct / total) * 100),
  });
  saveJSON('history:' + id, history.slice(-HISTORY_MAX));
}

function renderHistory() {
  const box = $('historyList');
  box.innerHTML = '';
  for (const s of SUBJECTS) {
    const h = loadJSON('history:' + s.id, []);
    const div = document.createElement('div');
    div.className = 'hist';
    const title = document.createElement('h3');
    title.textContent = `${s.icon} ${s.name}`;
    div.appendChild(title);
    const normal = h.filter((r) => r.mode === 'normal');
    const summary = document.createElement('p');
    summary.className = 'hint';
    if (!h.length) summary.textContent = '아직 기록이 없습니다';
    else {
      const avg = normal.length ? Math.round(normal.reduce((a, r) => a + r.score, 0) / normal.length) : '-';
      const best = normal.length ? Math.max(...normal.map((r) => r.score)) : '-';
      summary.textContent = `일반 ${normal.length}회 · 평균 ${avg}점 · 최고 ${best}점 · 오답노트 ${wrongNoteItems(s.id).length}문제 남음`;
    }
    div.appendChild(summary);
    if (h.length) {
      const table = document.createElement('table');
      for (const r of h.slice(-10).reverse()) {
        const tr = table.insertRow();
        const d = new Date(r.date);
        tr.insertCell().textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        tr.insertCell().textContent = r.mode === 'wrong' ? '오답노트' : '일반';
        tr.insertCell().textContent = `${r.correct}/${r.total} · ${r.score}점`;
      }
      div.appendChild(table);
    }
    box.appendChild(div);
  }
  show('history');
}

function renderResult() {
  saveRound();
  const total = state.questions.length;
  $('resultSubject').textContent = `${state.subject.name}${state.mode === 'wrong' ? ' 오답노트' : ''} 결과`;
  $('scoreNum').textContent = Math.round((state.correct / total) * 100);
  const score = Math.round((state.correct / total) * 100);
  $('resultEmoji').textContent = score >= 90 ? '🏆' : score >= 70 ? '🌟' : score >= 50 ? '🌱' : '💪';
  $('resultMsg').textContent = score >= 90 ? '훌륭해요! 이대로만 가요'
    : score >= 70 ? '잘하고 있어요, 조금만 더!'
    : score >= 50 ? '차근차근 늘고 있어요'
    : '오답노트로 한 번 더 복습해봐요';
  $('scoreDetail').textContent = `${total}문제 중 ${state.correct}문제 정답`
    + (total < QUESTIONS_PER_ROUND ? ` (문제은행에 ${total}문제만 있음)` : '');

  $('wrongTitle').textContent = state.wrong.length ? `틀린 문제 ${state.wrong.length}개` : '모두 맞혔습니다';
  const list = $('wrongList');
  list.innerHTML = '';
  for (const w of state.wrong) {
    const li = document.createElement('li');
    const add = (cls, text) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      d.textContent = text;
      li.appendChild(d);
    };
    add('', w.q);
    add('mine', `내 답: ${MARKS[w.mine]} ${w.choices[w.mine]}`);
    add('ans', `정답: ${MARKS[w.answer]} ${w.choices[w.answer]}`);
    if (w.exp) add('exp', w.exp);
    list.appendChild(li);
  }
  show('result');
}

// ---------- 시작 ----------

$('actionBtn').onclick = () => (state.submitted ? next() : submit());
$('retryBtn').onclick = () => startRound(state.subject, state.mode);
$('homeBtn').onclick = () => { renderHome(); show('home'); };
$('quitBtn').onclick = () => { if (confirm('풀이를 그만두고 과목 선택으로 갈까요?')) { renderHome(); show('home'); } };
$('historyBtn').onclick = renderHistory;
$('historyBack').onclick = () => show('home');

Promise.all(SUBJECTS.map(loadBank)).then(renderHome);
