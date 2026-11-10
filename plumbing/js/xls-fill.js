/* 옛 엑셀(.xls, BIFF8) 견적서 채우기
 * 사장님 .xls 견적서에서 '칸 값만' 바꾸고, 글꼴·테두리·도장 그림·매크로 등 나머지는 그대로 둔다.
 * 칸 크기가 바뀌므로 시트 안의 위치 목차(INDEX, DBCELL)만 다시 계산한다.
 * 필요한 라이브러리: CFB (vendor/cfb.js). 브라우저/Node 양쪽에서 동작.
 */
(function (root) {
  const R = { BOF: 0x809, EOF: 0x0a, INDEX: 0x20b, DBCELL: 0xd7, ROW: 0x208, LABELSST: 0xfd, LABEL: 0x204, NUMBER: 0x203,
    RK: 0x27e, MULRK: 0xbd, BLANK: 0x201, MULBLANK: 0xbe, FORMULA: 0x06, STRING: 0x207, BOOLERR: 0x205, DEFCOLWIDTH: 0x55 };
  const CELL = new Set([R.LABELSST, R.LABEL, R.NUMBER, R.RK, R.MULRK, R.BLANK, R.MULBLANK, R.FORMULA, R.BOOLERR]);

  // 칸 위치 (사장님 견적서 기준, 0부터 셈: 행 0 = 엑셀 1행, 열 0 = A)
  const MAP = {
    date: [1, 4], site: [2, 0], title: [3, 0], totalLine: [8, 0],
    itemFirstRow: 11, itemLastRow: 26, cols: { name: 1, unit: 2, qty: 3, price: 4, amount: 5, note: 6 },
    total: [27, 5],
  };

  const u8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  function readRecords(buf) {
    const v = dv(buf); const out = []; let off = 0;
    while (off + 4 <= buf.length) {
      const type = v.getUint16(off, true), len = v.getUint16(off + 2, true);
      out.push({ type, body: buf.slice(off + 4, off + 4 + len) }); off += 4 + len;
    }
    return out;
  }
  const rec = (type, body) => ({ type, body });
  function u16(n) { const b = new Uint8Array(2); dv(b).setUint16(0, n, true); return b; }
  function cat(...parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
  function head(r, c, xf) { const b = new Uint8Array(6); const v = dv(b); v.setUint16(0, r, true); v.setUint16(2, c, true); v.setUint16(4, xf, true); return b; }
  function uniStr(s, twoByteLen = true) { // XLUnicodeString (UTF-16)
    s = String(s).slice(0, 255);
    const b = new Uint8Array((twoByteLen ? 2 : 1) + 1 + s.length * 2); const v = dv(b); let o = 0;
    if (twoByteLen) { v.setUint16(0, s.length, true); o = 2; } else { b[0] = s.length; o = 1; }
    b[o++] = 1;
    for (let i = 0; i < s.length; i++) v.setUint16(o + i * 2, s.charCodeAt(i), true);
    return b;
  }

  // 시트 하나를 행별 칸 목록으로
  function splitCells(records) {
    // MULBLANK / MULRK 를 칸 하나씩으로 풀어 둔다 (바꾸기 쉽게)
    const out = [];
    for (const r of records) {
      if (r.type === R.MULBLANK) {
        const v = dv(r.body), row = v.getUint16(0, true), c0 = v.getUint16(2, true), n = (r.body.length - 6) / 2;
        for (let i = 0; i < n; i++) out.push(rec(R.BLANK, head(row, c0 + i, v.getUint16(4 + i * 2, true))));
      } else if (r.type === R.MULRK) {
        const v = dv(r.body), row = v.getUint16(0, true), c0 = v.getUint16(2, true), n = (r.body.length - 6) / 6;
        for (let i = 0; i < n; i++) out.push(rec(R.RK, cat(head(row, c0 + i, v.getUint16(4 + i * 6, true)), r.body.slice(6 + i * 6, 10 + i * 6))));
      } else out.push(r);
    }
    return out;
  }

  // 위치 목차(INDEX, DBCELL) 다시 계산하며 시트를 바이트로
  function serializeSheet(records, sheetStart) {
    // 1차: 크기 계산으로 위치 잡기
    const pos = []; let p = sheetStart;
    for (const r of records) { pos.push(p); p += 4 + r.body.length; }
    // DBCELL 다시 쓰기 (DBCELL 길이는 행 수로 정해져서 바뀌지 않음)
    let blockRows = [];
    const firstCellOf = new Map();
    records.forEach((r, i) => {
      if (r.type === R.ROW) blockRows.push(i);
      else if (CELL.has(r.type)) { const row = dv(r.body).getUint16(0, true); if (!firstCellOf.has(row)) firstCellOf.set(row, i); }
      else if (r.type === R.DBCELL) {
        const nb = new Uint8Array(4 + blockRows.length * 2); const v = dv(nb);
        if (blockRows.length) {
          v.setUint32(0, pos[i] - pos[blockRows[0]], true);
          let prev = pos[blockRows[0]] + 4 + records[blockRows[0]].body.length;
          blockRows.forEach((ri, k) => {
            const row = dv(records[ri].body).getUint16(0, true); const fc = firstCellOf.get(row);
            const cur = fc != null ? pos[fc] : prev;
            v.setUint16(4 + k * 2, cur - prev, true); prev = cur;
          });
        }
        r.body = nb; blockRows = [];
      }
    });
    // INDEX: DEFCOLWIDTH 위치와 DBCELL 위치들
    const idx = records.findIndex((r) => r.type === R.INDEX);
    if (idx >= 0) {
      const b = new Uint8Array(records[idx].body); const v = dv(b);
      const dbs = records.map((r, i) => (r.type === R.DBCELL ? pos[i] : null)).filter((x) => x != null);
      const dcw = records.findIndex((r) => r.type === R.DEFCOLWIDTH);
      if (dcw >= 0) v.setUint32(12, pos[dcw], true);
      if (b.length === 16 + dbs.length * 4) dbs.forEach((x, k) => v.setUint32(16 + k * 4, x, true));
      else throw new Error('엑셀 목차(INDEX) 모양이 예상과 다릅니다');
      records[idx].body = b;
    }
    const out = new Uint8Array(p - sheetStart); const ov = dv(out); let o = 0;
    for (const r of records) { ov.setUint16(o, r.type, true); ov.setUint16(o + 2, r.body.length, true); out.set(r.body, o + 4); o += 4 + r.body.length; }
    return out;
  }

  function sheetEditor(records) {
    const find = (row, col) => records.findIndex((r) => CELL.has(r.type) && dv(r.body).getUint16(0, true) === row && dv(r.body).getUint16(2, true) === col);
    const xfOf = (i) => dv(records[i].body).getUint16(4, true);
    function replace(row, col, makeBody, type) {
      let i = find(row, col);
      if (i < 0) return false; // 양식에 없는 칸은 건드리지 않음 (테두리 없는 칸)
      if (records[i].type === R.FORMULA && records[i + 1] && records[i + 1].type === R.STRING) records.splice(i + 1, 1);
      records[i] = rec(type, makeBody(xfOf(i)));
      return true;
    }
    return {
      text(row, col, s) {
        if (s === '' || s == null) return replace(row, col, (xf) => head(row, col, xf), R.BLANK);
        return replace(row, col, (xf) => cat(head(row, col, xf), uniStr(s)), R.LABEL);
      },
      number(row, col, n) {
        if (n === '' || n == null || !isFinite(Number(n))) return replace(row, col, (xf) => head(row, col, xf), R.BLANK);
        return replace(row, col, (xf) => { const b = cat(head(row, col, xf), new Uint8Array(8)); dv(b).setFloat64(6, Number(n), true); return b; }, R.NUMBER);
      },
      // 수식은 그대로 두고 계산값만 바꿈
      formulaNumber(row, col, n) {
        const i = find(row, col); if (i < 0 || records[i].type !== R.FORMULA) return false;
        const b = new Uint8Array(records[i].body); dv(b).setFloat64(6, Number(n) || 0, true);
        records[i].body = b;
        if (records[i + 1] && records[i + 1].type === R.STRING) records.splice(i + 1, 1);
        return true;
      },
      formulaString(row, col, s) {
        const i = find(row, col); if (i < 0 || records[i].type !== R.FORMULA) return false;
        const b = new Uint8Array(records[i].body); b.fill(0, 6, 14); b[6] = 0; b[12] = 0xff; b[13] = 0xff;
        records[i].body = b;
        const str = rec(R.STRING, uniStr(s));
        if (records[i + 1] && records[i + 1].type === R.STRING) records[i + 1] = str; else records.splice(i + 1, 0, str);
        return true;
      },
    };
  }

  function locateSheet(recs) {
    // 첫 BOF(전역) 다음에 나오는 워크시트 BOF(type 0x10)
    let off = 0; const pos = [];
    for (const r of recs) { pos.push(off); off += 4 + r.body.length; }
    const start = recs.findIndex((r, i) => i > 0 && r.type === R.BOF && dv(r.body).getUint16(2, true) === 0x10);
    if (start < 0) throw new Error('엑셀 시트를 찾지 못했습니다');
    let end = start + 1; while (end < recs.length && recs[end].type !== R.EOF) end++;
    return { start, end, startPos: pos[start] };
  }

  function getWorkbook(CFB, cfb) {
    const e = CFB.find(cfb, 'Root Entry/Workbook') || CFB.find(cfb, 'Workbook') || CFB.find(cfb, 'Root Entry/Book');
    if (!e) throw new Error('엑셀(.xls) 파일이 아닙니다');
    return e;
  }

  function isXls(buf) { const b = u8(buf); return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; }

  /** 사장님 .xls 견적서 채우기 → { file: Uint8Array, warnings } */
  function fillXls(templateBuf, est, core, env = {}) {
    const CFB = env.CFB || root.CFB;
    const cfb = CFB.read(u8(templateBuf), { type: 'array' });
    const entry = getWorkbook(CFB, cfb);
    const wb = u8(entry.content);
    const recs = readRecords(wb);
    const { start, end, startPos } = locateSheet(recs);
    const sheet = splitCells(recs.slice(start, end + 1));
    const E = sheetEditor(sheet);
    const warnings = [];
    const pad2 = (n) => String(n).padStart(2, '0');

    const [y, m, d] = String(est.date || '').split('-');
    E.text(MAP.date[0], MAP.date[1], y ? `${y} 年  ${pad2(m)} 月 ${pad2(d)} 日 ` : '');
    E.text(MAP.site[0], MAP.site[1], est.address || est.customer || '');
    E.text(MAP.title[0], MAP.title[1], `공사명 : ${est.title || ''}`);

    const items = (est.items || []).filter((it) => it.name || it.price);
    const slots = MAP.itemLastRow - MAP.itemFirstRow + 1;
    if (items.length > slots) warnings.push(`엑셀 양식 품목 칸이 ${slots}줄이라 ${items.length - slots}개는 들어가지 않았습니다`);
    const C = MAP.cols;
    for (let k = 0; k < slots; k++) {
      const r = MAP.itemFirstRow + k, it = items[k];
      const qty = it && it.qty !== '' && it.qty != null ? Number(it.qty) : '';
      E.text(r, C.name, it ? [it.name, it.spec].filter(Boolean).join(' ') : '');
      E.text(r, C.unit, it ? it.unit || '' : '');
      E.number(r, C.qty, it ? qty : '');
      E.number(r, C.price, it && it.price ? it.price : '');
      E.formulaNumber(r, C.amount, it && it.price ? core.lineAmount(it) : 0);
      E.text(r, C.note, it ? it.note || '' : '');
    }
    const total = core.calcTotals(items, est.vatMode).total;
    E.formulaNumber(MAP.total[0], MAP.total[1], total);
    E.formulaString(MAP.totalLine[0], MAP.totalLine[1], `合計金額 : ${core.toKoreanMoney(total)}원整  (￦ ${core.won(total)} )  *부가가치세 별도`);

    const sheetBytes = serializeSheet(sheet, startPos);
    let before = 0; for (let i = 0; i < start; i++) before += 4 + recs[i].body.length;
    let after = 0; for (let i = end + 1; i < recs.length; i++) after += 4 + recs[i].body.length;
    const out = new Uint8Array(before + sheetBytes.length + after);
    out.set(wb.slice(0, before), 0); out.set(sheetBytes, before); out.set(wb.slice(wb.length - after), before + sheetBytes.length);
    entry.content = out; entry.size = out.length;
    return { file: u8(CFB.write(cfb, { type: 'array', fileType: 'cfb' })), warnings };
  }

  function checkXlsTemplate(buf, env = {}) {
    try {
      const CFB = env.CFB || root.CFB;
      const recs = readRecords(u8(getWorkbook(CFB, CFB.read(u8(buf), { type: 'array' })).content));
      locateSheet(recs); return { ok: true };
    } catch (e) { return { ok: false, why: e.message }; }
  }

  const api = { fillXls, checkXlsTemplate, isXls, MAP, _internal: { readRecords, splitCells, serializeSheet, locateSheet } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsFill = api;
})(typeof window !== 'undefined' ? window : globalThis);
