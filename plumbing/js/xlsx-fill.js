/* 엑셀 견적서(.xlsx) 채우기
 * 사장님이 쓰던 엑셀 견적서 칸 위치에 맞춰 '값만' 바꾼다.
 * 글꼴·테두리·칸 너비·초록 띠·도장 그림 등은 원본 그대로 남는다.
 * 브라우저(DOMParser)와 Node(@xmldom/xmldom) 양쪽에서 동작.
 */
(function (root) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  // 견적서 칸 위치 (사장님 엑셀 양식 기준). 양식이 바뀌면 여기만 고치면 된다.
  const MAP = {
    date: 'E2', site: 'A3', title: 'A4', totalLine: 'A9',
    itemFirstRow: 12, itemLastRow: 27,
    itemCols: { name: 'B', unit: 'C', qty: 'D', price: 'E', amount: 'F', note: 'G' },
    totalCell: 'F28', memo: 'B29',
    // 양식에 비어 있을 때만 앱의 업체정보로 채움 (사장님 양식에는 이미 적혀 있음)
    company: { name: 'E3', owner: 'E4', address: 'E6', tel: 'E7', phone: 'E8' },
    // 도장 자리 (사장님 엑셀과 같은 곳: G열, 3~4행). 0부터 세는 열/행 번호, EMU 단위 여백
    stamp: { col: 6, colOff: 259920, row: 2, rowOff: 47520, cx: 720000, cy: 720000 },
  };

  // 양식에 그림(도장)이 없을 때 설정의 도장 그림을 넣는다
  async function addStamp(zip, sheetPath, doc, png) {
    if (doc.getElementsByTagNameNS(NS, 'drawing').length) return false; // 이미 그림이 있는 양식(사장님 양식)은 그대로
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sheetFile = sheetPath.split('/').pop();
    const relsPath = sheetPath.replace(sheetFile, '_rels/' + sheetFile + '.rels');
    let n = 1; while (zip.file(`xl/drawings/drawing${n}.xml`)) n++;
    let m = 1; while (zip.file(`xl/media/stamp${m}.png`)) m++;
    const drawingPath = `xl/drawings/drawing${n}.xml`, mediaName = `stamp${m}.png`;
    zip.file('xl/media/' + mediaName, png);
    const a = MAP.stamp;
    zip.file(drawingPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + R + '">' +
      `<xdr:oneCellAnchor><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${a.cx}" cy="${a.cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="도장"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${a.cx}" cy="${a.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${R}/image" Target="../media/${mediaName}"/></Relationships>`);
    // 시트 → 그림 연결
    let rels = zip.file(relsPath) ? await zip.file(relsPath).async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let rid = 1; while (rels.includes(`Id="rIdStamp${rid}"`)) rid++;
    const relId = `rIdStamp${rid}`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${relId}" Type="${R}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`);
    zip.file(relsPath, rels);
    const ws = doc.documentElement;
    if (!ws.getAttribute('xmlns:r')) ws.setAttribute('xmlns:r', R);
    const dr = doc.createElementNS(NS, 'drawing'); dr.setAttributeNS(R, 'r:id', relId);
    // <drawing> 은 정해진 순서가 있음: 아래 요소들보다 앞에 둔다
    const after = ['legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
    const next = Array.from(ws.childNodes).find((x) => x.nodeType === 1 && after.includes(x.localName));
    ws.insertBefore(dr, next || null);
    // 파일 종류 등록
    let ct = await zip.file('[Content_Types].xml').async('string');
    if (!/Extension="png"/i.test(ct)) ct = ct.replace('<Default ', '<Default Extension="png" ContentType="image/png"/><Default ');
    ct = ct.replace('</Types>', `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    zip.file('[Content_Types].xml', ct);
    return true;
  }

  const colNum = (ref) => ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const rowNum = (ref) => Number(ref.replace(/\D+/g, ''));
  const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === name);

  function sheetTools(doc, shared) {
    const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    function getRow(r) {
      const rows = kids(sheetData, 'row');
      let row = rows.find((x) => Number(x.getAttribute('r')) === r);
      if (row) return row;
      row = doc.createElementNS(NS, 'row'); row.setAttribute('r', String(r));
      const after = rows.find((x) => Number(x.getAttribute('r')) > r);
      sheetData.insertBefore(row, after || null);
      return row;
    }
    function getCell(ref) {
      const row = getRow(rowNum(ref));
      const cells = kids(row, 'c');
      let c = cells.find((x) => x.getAttribute('r') === ref);
      if (c) return c;
      c = doc.createElementNS(NS, 'c'); c.setAttribute('r', ref);
      const after = cells.find((x) => colNum(x.getAttribute('r')) > colNum(ref));
      row.insertBefore(c, after || null);
      return c;
    }
    function clear(c) { while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t'); }
    function readText(ref) {
      const row = kids(sheetData, 'row').find((x) => Number(x.getAttribute('r')) === rowNum(ref));
      const c = row && kids(row, 'c').find((x) => x.getAttribute('r') === ref);
      if (!c) return '';
      const t = c.getAttribute('t'), v = kids(c, 'v')[0];
      if (t === 's' && v) return shared[Number(v.textContent)] || '';
      if (t === 'inlineStr') return Array.from(c.getElementsByTagNameNS(NS, 't')).map((x) => x.textContent).join('');
      return v ? v.textContent : '';
    }
    function setText(ref, text) {
      const c = getCell(ref); clear(c);
      if (text === '' || text == null) return;
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
      t.setAttribute('xml:space', 'preserve'); t.appendChild(doc.createTextNode(String(text)));
      is.appendChild(t); c.appendChild(is);
    }
    function setNumber(ref, n) {
      const c = getCell(ref); clear(c);
      if (n === '' || n == null || !isFinite(Number(n))) return;
      c.setAttribute('t', 'n');
      const v = doc.createElementNS(NS, 'v'); v.appendChild(doc.createTextNode(String(Number(n)))); c.appendChild(v);
    }
    function setFormula(ref, formula, cached, isString) {
      const c = getCell(ref); clear(c);
      if (isString) c.setAttribute('t', 'str');
      const f = doc.createElementNS(NS, 'f'); f.appendChild(doc.createTextNode(formula)); c.appendChild(f);
      const v = doc.createElementNS(NS, 'v'); v.appendChild(doc.createTextNode(String(cached))); c.appendChild(v);
    }
    return { readText, setText, setNumber, setFormula };
  }

  /**
   * @param est   견적 { date, address, customer, title, memo, vatMode, items:[{name,spec,unit,qty,price,note}] }
   * @param company 업체정보 { name, owner, address, tel, phone }
   * @param core  EstCore (금액 계산, 한글 금액)
   * @returns { blob|buffer, warnings: [] }
   */
  async function fillXlsx(templateBuf, est, company, core, env) {
    const zip = await env.JSZip.loadAsync(templateBuf);
    const parser = new env.DOMParser(), ser = new env.XMLSerializer();
    const sheetPath = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!sheetPath) throw new Error('엑셀(.xlsx) 견적서 양식이 아닙니다');
    let shared = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const sdoc = parser.parseFromString(await zip.file('xl/sharedStrings.xml').async('string'), 'application/xml');
      shared = Array.from(sdoc.getElementsByTagNameNS(NS, 'si')).map((si) =>
        Array.from(si.getElementsByTagNameNS(NS, 't')).map((t) => t.textContent).join(''));
    }
    const doc = parser.parseFromString(await zip.file(sheetPath).async('string'), 'application/xml');
    const S = sheetTools(doc, shared);
    const warnings = [];

    const [y, m, d] = String(est.date || '').split('-');
    S.setText(MAP.date, y ? `${y} 年  ${m} 月 ${d} 日 ` : '');
    S.setText(MAP.site, est.address || est.customer || '');
    S.setText(MAP.title, `공사명 : ${est.title || ''}`);

    const items = (est.items || []).filter((it) => it.name || it.price);
    const slots = MAP.itemLastRow - MAP.itemFirstRow + 1;
    if (items.length > slots) warnings.push(`엑셀 양식 품목 칸이 ${slots}줄이라 ${items.length - slots}개는 들어가지 않았습니다`);
    const C = MAP.itemCols;
    for (let i = 0; i < slots; i++) {
      const r = MAP.itemFirstRow + i, it = items[i];
      const qty = it && it.qty !== '' && it.qty != null ? Number(it.qty) : '';
      S.setText(C.name + r, it ? [it.name, it.spec].filter(Boolean).join(' ') : '');
      S.setText(C.unit + r, it ? it.unit || '' : '');
      S.setNumber(C.qty + r, it ? qty : '');
      S.setNumber(C.price + r, it && it.price ? it.price : '');
      S.setFormula(C.amount + r, `PRODUCT(${C.qty}${r}:${C.price}${r})`, it && it.price ? core.lineAmount(it) : 0);
      S.setText(C.note + r, it ? it.note || '' : '');
    }
    const total = core.calcTotals(items, est.vatMode).total;
    const fr = `${C.amount}${MAP.itemFirstRow}:${C.amount}${MAP.itemLastRow}`;
    S.setFormula(MAP.totalCell, `SUM(${fr})`, total);
    const vat = est.vatMode === 'included' ? '포함' : '별도';
    S.setFormula(MAP.totalLine,
      `"合計金額 : "&NUMBERSTRING(${MAP.totalCell},1)&"원整  (￦ "&TEXT(${MAP.totalCell},"#,##0")&" )  *부가가치세 ${vat}"`,
      `合計金額 : ${core.toKoreanMoney(total)}원整  (￦ ${core.won(total)} )  *부가가치세 ${vat}`, true);
    S.setText(MAP.memo, String(est.memo || '').split(/\r?\n/).filter(Boolean).join(' / '));

    // 업체정보: 양식 칸이 비어 있을 때만 채움 (사장님 양식에는 이미 적혀 있음)
    const co = MAP.company;
    const fillCo = (ref, text, val) => { if (val && !S.readText(ref).trim()) S.setText(ref, text); };
    fillCo(co.name, company.name, company.name);
    fillCo(co.owner, `대  표 : ${company.owner}`, company.owner);
    fillCo(co.address, company.address, company.address);
    fillCo(co.tel, `TEL : ${company.tel}`, company.tel);
    fillCo(co.phone, `H.P : ${company.phone}`, company.phone);

    if (env.stamp) await addStamp(zip, sheetPath, doc, env.stamp);

    let out = ser.serializeToString(doc);
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
    zip.file(sheetPath, out);
    // 계산 순서 캐시가 있으면 지워서 엑셀이 새로 계산하게 함
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
      const rel = await zip.file('xl/_rels/workbook.xml.rels').async('string');
      zip.file('xl/_rels/workbook.xml.rels', rel.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''));
    }
    const file = await zip.generateAsync({
      type: env.outType || 'blob', compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { file, warnings };
  }

  async function checkTemplate(buf, env) {
    const zip = await env.JSZip.loadAsync(buf);
    return Object.keys(zip.files).some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  }

  const api = { fillXlsx, checkTemplate, MAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsxFill = api;
})(typeof window !== 'undefined' ? window : globalThis);
