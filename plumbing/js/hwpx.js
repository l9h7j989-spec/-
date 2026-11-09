/* HWPX 견적서 채우기 엔진
 * - 양식(.hwpx) 안의 {{키}} 를 값으로 바꾼다.
 * - {{name}} 이 들어있는 표 행(item row)을 품목 수만큼 복제한다.
 * - 줄바꿈이 있는 값이 문단 전체를 차지하면 줄마다 문단을 복제한다.
 * 브라우저(DOMParser)와 Node(@xmldom/xmldom) 양쪽에서 동작한다.
 */
(function (root) {
  const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  const ITEM_KEYS = ['no', 'name', 'spec', 'qty', 'unit', 'price', 'amount', 'note'];

  function byTag(node, local) {
    return Array.from(node.getElementsByTagNameNS(HP, local));
  }
  function childrenByTag(node, local) {
    return Array.from(node.childNodes).filter(
      (n) => n.nodeType === 1 && n.namespaceURI === HP && n.localName === local
    );
  }
  function textOf(node) {
    return byTag(node, 't').map((t) => t.textContent).join('');
  }
  function randId() {
    return String(Math.floor(1e9 + Math.random() * 1e9));
  }
  function setText(t, text) {
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(t.ownerDocument.createTextNode(text));
  }

  // 한글이 {{키}} 를 여러 run/t 로 쪼개 저장한 경우 하나로 합친다.
  function mergeSplitPlaceholders(doc) {
    for (const p of byTag(doc, 'p')) {
      const ts = childrenByTag(p, 'run').flatMap((r) => childrenByTag(r, 't'));
      if (ts.length < 2) continue;
      const broken = ts.some((t) => {
        const s = t.textContent;
        return (s.match(/\{\{/g) || []).length !== (s.match(/\}\}/g) || []).length ||
          /\{$|^\}/.test(s);
      });
      if (!broken) continue;
      const full = ts.map((t) => t.textContent).join('');
      if (!/\{\{[^}]+\}\}/.test(full)) continue;
      setText(ts[0], full);
      ts.slice(1).forEach((t) => setText(t, ''));
    }
  }

  function replaceIn(str, data) {
    return str.replace(/\{\{\s*([\w가-힣]+)\s*\}\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(data, k) ? String(data[k] ?? '') : m
    );
  }

  function replaceAllText(node, data) {
    for (const t of byTag(node, 't')) {
      const s = t.textContent;
      if (s.includes('{{')) setText(t, replaceIn(s, data).replace(/\n/g, ' '));
    }
  }

  function renumberIds(node) {
    for (const p of byTag(node, 'p')) if (p.getAttribute('id')) p.setAttribute('id', randId());
  }

  // 품목 행 복제
  function expandItemRows(doc, items) {
    const rows = byTag(doc, 'tr').filter((tr) => /\{\{\s*(name|품명)\s*\}\}/.test(textOf(tr)));
    for (const tr of rows) {
      const tbl = tr.parentNode;
      const allRows = childrenByTag(tbl, 'tr');
      const idx = allRows.indexOf(tr);
      const delta = items.length - 1;
      for (const it of items) {
        const clone = tr.cloneNode(true);
        replaceAllText(clone, it);
        renumberIds(clone);
        tbl.insertBefore(clone, tr);
      }
      // 복제 행의 rowAddr 는 원래 행 기준 + 순번
      const inserted = childrenByTag(tbl, 'tr').slice(idx, idx + items.length);
      inserted.forEach((row, i) => {
        for (const a of byTag(row, 'cellAddr')) if (a.parentNode.parentNode === row)
          a.setAttribute('rowAddr', String(idx + i));
      });
      tbl.removeChild(tr);
      // 뒤쪽 행 rowAddr 밀기
      childrenByTag(tbl, 'tr').slice(idx + items.length).forEach((row) => {
        for (const tc of childrenByTag(row, 'tc')) {
          const a = childrenByTag(tc, 'cellAddr')[0];
          if (a) a.setAttribute('rowAddr', String(Number(a.getAttribute('rowAddr')) + delta));
        }
      });
      tbl.setAttribute('rowCnt', String(Number(tbl.getAttribute('rowCnt')) + delta));
      const sz = childrenByTag(tbl, 'sz')[0];
      const cellSz = byTag(tr, 'cellSz')[0];
      if (sz && cellSz) {
        const h = Number(sz.getAttribute('height')) + delta * Number(cellSz.getAttribute('height') || 0);
        sz.setAttribute('height', String(Math.max(h, 0)));
      }
    }
  }

  // 문단 전체가 {{키}} 하나이고 값이 여러 줄이면 줄마다 문단을 만든다.
  function expandMultiline(doc, data) {
    for (const p of byTag(doc, 'p')) {
      const m = textOf(p).trim().match(/^\{\{\s*([\w가-힣]+)\s*\}\}$/);
      if (!m) continue;
      const v = data[m[1]];
      if (typeof v !== 'string' || !v.includes('\n')) continue;
      const lines = v.split(/\r?\n/);
      for (const line of lines) {
        const c = p.cloneNode(true);
        const ts = byTag(c, 't');
        setText(ts[0], line);
        ts.slice(1).forEach((t) => setText(t, ''));
        renumberIds(c);
        if (c.getAttribute('id')) c.setAttribute('id', randId());
        p.parentNode.insertBefore(c, p);
      }
      p.parentNode.removeChild(p);
    }
  }

  // 줄 배치 캐시는 지우면 한글이 다시 계산한다.
  function dropLineSegs(doc) {
    for (const ls of byTag(doc, 'linesegarray')) ls.parentNode.removeChild(ls);
  }

  async function fillHwpx(templateBuf, data, items, env) {
    const JSZip = env.JSZip;
    const parser = new env.DOMParser();
    const ser = new env.XMLSerializer();
    const zip = await JSZip.loadAsync(templateBuf);
    const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n));
    if (!sections.length) throw new Error('HWPX 양식에서 본문(section)을 찾지 못했습니다.');
    const itemData = items.map((it, i) => {
      const o = { ...it, no: it.no ?? String(i + 1) };
      o.품명 = o.name; o.규격 = o.spec; o.수량 = o.qty; o.단위 = o.unit;
      o.단가 = o.price; o.금액 = o.amount; o.비고 = o.note;
      return o;
    });
    for (const name of sections) {
      const xml = await zip.file(name).async('string');
      const doc = parser.parseFromString(xml, 'application/xml');
      mergeSplitPlaceholders(doc);
      expandItemRows(doc, itemData);
      expandMultiline(doc, data);
      replaceAllText(doc, data);
      dropLineSegs(doc);
      let out = ser.serializeToString(doc);
      if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + out;
      zip.file(name, out);
    }
    // 도장 그림 바꾸기 (양식 안 BinData/stamp.* 를 사용자 도장 PNG 로)
    if (env.stamp) {
      const stampName = Object.keys(zip.files).find((n) => /^BinData\/stamp\.\w+$/i.test(n));
      if (stampName) zip.file(stampName, env.stamp);
    }
    // 미리보기 텍스트 갱신(선택)
    if (zip.file('Preview/PrvText.txt')) zip.file('Preview/PrvText.txt', String(data.title || '견적서'));
    // mimetype 은 첫 항목 + 무압축이어야 한다.
    const mime = await zip.file('mimetype').async('string');
    zip.file('mimetype', mime, { compression: 'STORE' });
    return zip.generateAsync({
      type: env.outType || 'blob',
      mimeType: 'application/hwp+zip',
      compression: 'DEFLATE',
    });
  }

  const api = { fillHwpx, ITEM_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Hwpx = api;
})(typeof window !== 'undefined' ? window : globalThis);
