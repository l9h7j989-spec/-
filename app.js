const SUBJECTS = [
  { id: 'korean', name: '국어', file: 'data/korean.csv' },
  { id: 'english', name: '영어', file: 'data/english.csv' },
  { id: 'admin_law', name: '행정법', file: 'data/admin_law.csv' },
  { id: 'education', name: '교육학', file: 'data/education.csv' },
];
const QUESTIONS_PER_ROUND = 25;
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

// ---------- 화면 ----------

function show(screen) {
  for (const id of ['home', 'quiz', 'result']) $(id).classList.toggle('hidden', id !== screen);
  window.scrollTo(0, 0);
}

function renderHome() {
  const box = $('subjects');
  box.innerHTML = '';
  for (const s of SUBJECTS) {
    const b = banks[s.id];
    const btn = document.createElement('button');
    btn.className = 'subject';
    const info = b.error ? '문제 파일을 못 읽음'
      : `${b.list.length}문제${b.custom ? ' · 직접 불러옴' : ''}`;
    btn.innerHTML = `<b>${s.name}</b><span>${info}</span>`;
    btn.disabled = b.list.length === 0;
    btn.onclick = () => startRound(s);
    box.appendChild(btn);
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

function startRound(subject) {
  // 섞은 뒤 앞에서 25개만 가져오므로 한 회차 안에서는 문제가 겹치지 않음
  const questions = shuffle(banks[subject.id].list).slice(0, QUESTIONS_PER_ROUND);
  state = { subject, questions, index: 0, selected: null, submitted: false, correct: 0, wrong: [] };
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
  if (ok) state.correct++;
  else state.wrong.push({ ...item, mine: state.selected });

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

function renderResult() {
  const total = state.questions.length;
  $('resultSubject').textContent = `${state.subject.name} 결과`;
  $('scoreNum').textContent = Math.round((state.correct / total) * 100);
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
$('quitBtn').onclick = () => { if (confirm('풀이를 그만두고 과목 선택으로 갈까요?')) show('home'); };
$('retryBtn').onclick = () => startRound(state.subject);
$('homeBtn').onclick = () => show('home');

Promise.all(SUBJECTS.map(loadBank)).then(renderHome);
