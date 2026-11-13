/*
 * quote.js — 견적서 엑셀 만들기
 * 사용자가 올린 "빈 견적서 양식(.xlsx)"을 그대로 두고 필요한 칸에만 값을 채웁니다.
 * 그래서 로고·도장·테두리·글꼴·인쇄 설정이 원본과 똑같이 나옵니다.
 * 양식 파일은 이 휴대폰 안에만 저장됩니다. (사업자번호·계좌·도장이 들어 있어 인터넷 저장소에는 올리지 않습니다)
 */
(function (root) {
  'use strict';
  var TPL_KEY = 'mimifresh.quoteTemplate';
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var SHEET = 'xl/worksheets/sheet1.xml';
  var MAX_ITEMS = 6, FIRST_ROW = 15;

  function b64ToBytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function bytesToB64(a) { var s = ''; for (var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }

  function getTemplate() { try { var b = localStorage.getItem(TPL_KEY); return b ? b64ToBytes(b) : null; } catch (e) { return null; } }
  function hasTemplate() { try { return !!localStorage.getItem(TPL_KEY); } catch (e) { return false; } }
  /** 양식 파일 검사 후 저장. 맞지 않으면 오류를 던짐 */
  function setTemplate(bytes) {
    var files;
    try { files = fflate.unzipSync(bytes); } catch (e) { throw new Error('엑셀(.xlsx) 파일이 아닙니다.'); }
    if (!files[SHEET]) throw new Error('엑셀 파일에서 시트를 찾지 못했습니다.');
    var xml = fflate.strFromU8(files[SHEET]);
    var need = ['B9', 'G7', 'G11', 'C15', 'T15', 'AC15', 'AA28', 'A21'];
    for (var i = 0; i < need.length; i++) if (xml.indexOf('<c r="' + need[i] + '"') < 0) throw new Error('견적서 양식과 칸 위치가 다릅니다. (' + need[i] + ' 칸 없음) 빈 양식 원본을 올려 주세요.');
    try { localStorage.setItem(TPL_KEY, bytesToB64(bytes)); } catch (e) { throw new Error('양식을 저장할 공간이 부족합니다.'); }
  }
  function clearTemplate() { try { localStorage.removeItem(TPL_KEY); } catch (e) { /* 무시 */ } }

  /** 금액을 한글로 (엑셀 NUMBERSTRING(값,1) 과 같은 표기: 2640000 → 이백육십사만) */
  function koreanNumber(n) {
    n = Math.round(Math.abs(n));
    if (!n) return '영';
    var D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], U = ['', '십', '백', '천'], G = ['', '만', '억', '조'];
    var out = '', g = 0;
    while (n > 0) {
      var part = n % 10000, s = '';
      for (var i = 0; i < 4; i++) { var d = Math.floor(part / Math.pow(10, i)) % 10; if (d) s = D[d] + U[i] + s; }
      if (s) out = s + G[g] + out;
      n = Math.floor(n / 10000); g++;
    }
    return out;
  }
  function excelDate(ymd) { var p = ymd.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000); }

  /** 품목 한 줄의 금액 (서비스 줄은 0) */
  function lineAmount(it) { return it.service ? 0 : (Number(it.qty) || 0) * (Number(it.price) || 0); }
  function total(q) { return (q.items || []).slice(0, MAX_ITEMS).reduce(function (a, it) { return a + lineAmount(it); }, 0); }

  /** 양식(bytes) + 견적 내용(q) → 완성된 엑셀(bytes) */
  function build(tplBytes, q) {
    var files = fflate.unzipSync(tplBytes);
    var doc = new DOMParser().parseFromString(fflate.strFromU8(files[SHEET]), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('양식 파일을 읽지 못했습니다.');
    var cells = {};
    Array.prototype.forEach.call(doc.getElementsByTagNameNS(NS, 'c'), function (c) { cells[c.getAttribute('r')] = c; });
    var cell = function (ref) { if (!cells[ref]) throw new Error('양식에 ' + ref + ' 칸이 없습니다.'); return cells[ref]; };
    var child = function (c, tag) { for (var i = 0; i < c.childNodes.length; i++) if (c.childNodes[i].localName === tag) return c.childNodes[i]; return null; };
    var clear = function (c, keepFormula) {
      Array.prototype.slice.call(c.childNodes).forEach(function (n) { if (!(keepFormula && n.localName === 'f')) c.removeChild(n); });
      c.removeAttribute('t');
    };
    var el = function (tag, text) { var e = doc.createElementNS(NS, tag); if (text != null) e.textContent = text; return e; };
    var setText = function (ref, text) {
      var c = cell(ref); clear(c);
      if (text == null || text === '') return;
      c.setAttribute('t', 'inlineStr');
      var is = el('is'), t = el('t', String(text));
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      is.appendChild(t); c.appendChild(is);
    };
    var setNum = function (ref, n) { var c = cell(ref); clear(c); if (n == null || n === '' || isNaN(n)) return; c.appendChild(el('v', String(n))); };
    /** 수식은 그대로 두고, 미리 계산한 값만 넣는다 (엑셀이 아닌 뷰어에서도 숫자가 보이게) */
    var setCached = function (ref, v, isText) {
      var c = cell(ref);
      if (!child(c, 'f')) return isText ? setText(ref, v) : setNum(ref, v);
      clear(c, true);
      if (isText) c.setAttribute('t', 'str');
      c.appendChild(el('v', String(v)));
    };

    setNum('G7', excelDate(q.date));
    setText('B9', q.clientName);
    setText('G11', q.title);
    setText('AD13', q.vat === '별도' ? 'VAT 별도' : 'VAT 포함');
    var items = (q.items || []).slice(0, MAX_ITEMS), sum = 0;
    for (var i = 0; i < MAX_ITEMS; i++) {
      var r = FIRST_ROW + i, it = items[i];
      var has = it && String(it.name || '').trim();
      setText('C' + r, has ? it.name : '');
      setText('O' + r, has ? it.spec : '');
      if (!has || it.service) {
        setNum('Q' + r, null); setNum('T' + r, null);
        setCached('X' + r, 0);
        setText('AC' + r, has ? '서비스로 진행' : ''); // 합계 칸의 수식을 글자로 바꿈
      } else {
        var qty = Number(it.qty) || 0, price = Number(it.price) || 0, amt = qty * price;
        setNum('Q' + r, qty); setNum('T' + r, price);
        setCached('X' + r, amt);
        setCached('AC' + r, amt); // 수식이 없는 줄(4~6번)은 숫자로 들어감
        sum += amt;
      }
    }
    setCached('AA28', sum);
    setCached('V12', sum);
    setCached('H12', '一金      ' + koreanNumber(sum), true);
    setText('A21', q.desc);
    if (cells.F30) setText('F30', q.note);

    files[SHEET] = fflate.strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(doc.documentElement));
    // 엑셀이 열 때 수식을 전부 다시 계산하게 하고, 낡은 계산 순서표는 뺀다
    var wb = fflate.strFromU8(files['xl/workbook.xml']);
    wb = /<calcPr[^>]*\/>/.test(wb) ? wb.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>') : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    files['xl/workbook.xml'] = fflate.strToU8(wb);
    if (files['xl/calcChain.xml']) {
      delete files['xl/calcChain.xml'];
      var ct = '[Content_Types].xml', rel = 'xl/_rels/workbook.xml.rels';
      files[ct] = fflate.strToU8(fflate.strFromU8(files[ct]).replace(/<Override[^>]*calcChain\.xml[^>]*\/>/, ''));
      files[rel] = fflate.strToU8(fflate.strFromU8(files[rel]).replace(/<Relationship [^>]*calcChain\.xml[^>]*\/>/, ''));
    }
    return fflate.zipSync(files, { level: 6 });
  }

  root.Quote = { MAX_ITEMS: MAX_ITEMS, hasTemplate: hasTemplate, getTemplate: getTemplate, setTemplate: setTemplate, clearTemplate: clearTemplate, koreanNumber: koreanNumber, lineAmount: lineAmount, total: total, build: build };
})(window);
