/**
 * 공부 플래너 저장소 (구글 스프레드시트)
 * 시트 '기록'에 한 줄씩, 시트 '설정'에 목표 시간·과목 목록을 저장한다.
 * 웹 앱으로 배포하면 study.html이 이 주소로 읽고 쓴다.
 */
const LOG = '기록';
const SET = '설정';

function doGet() {
  return json_(readAll_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    for (const op of body.ops || []) apply_(op);
    return json_(readAll_());
  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function apply_(op) {
  const log = sheet_(LOG, ['id', '날짜', '과목', '분', '기록한 때']);
  if (op.type === 'add') {
    const x = op.entry;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !(Number(x.minutes) > 0)) return;
    if (findRow_(log, x.id)) return; // 같은 기록이 두 번 들어가지 않게
    const r = log.getLastRow() + 1;
    log.getRange(r, 1, 1, 5)
      .setNumberFormats([['@', '@', '@', '0', '@']])
      .setValues([[String(x.id), x.date, String(x.subject), Math.round(Number(x.minutes)),
        Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm')]]);
  } else if (op.type === 'del') {
    const r = findRow_(log, op.id);
    if (r) log.deleteRow(r);
  } else if (op.type === 'settings') {
    const set = sheet_(SET, ['항목', '값']);
    if (op.goal != null) setValue_(set, 'goal', String(Number(op.goal)));
    if (Array.isArray(op.subjects)) setValue_(set, 'subjects', JSON.stringify(op.subjects));
  }
}

function readAll_() {
  const log = sheet_(LOG, ['id', '날짜', '과목', '분', '기록한 때']);
  const entries = log.getDataRange().getValues().slice(1)
    .filter(r => r[0] !== '' && Number(r[3]) > 0)
    .map(r => ({ id: String(r[0]), date: date_(r[1]), subject: String(r[2]), minutes: Number(r[3]) }));
  const s = {};
  sheet_(SET, ['항목', '값']).getDataRange().getValues().slice(1).forEach(r => { s[r[0]] = r[1]; });
  let subjects = null;
  try { subjects = s.subjects ? JSON.parse(s.subjects) : null; } catch (err) {}
  return { entries, goal: Number(s.goal) || 40, subjects };
}

function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
function findRow_(sh, id) {
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return 0;
}
function setValue_(sh, key, value) {
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === key) { sh.getRange(i + 1, 2).setNumberFormat('@').setValue(value); return; }
  }
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 2).setNumberFormat('@').setValues([[key, value]]);
}
function date_(v) {
  return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v);
}
function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
