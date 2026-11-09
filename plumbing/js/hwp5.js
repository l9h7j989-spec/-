/* 한글 HWP(5.0) 소견서 채우기
 * 사장님 소견서 양식(.hwp)에서 아래 4곳의 '글자만' 바꾸고 나머지(표, 글꼴, 도장 그림 등)는 그대로 둔다.
 *   - '수리 내역' 칸의 내용
 *   - '1. 누수 발생 위치: ...'
 *   - '2. 누수 발생 원인: ...'   (= 수리 내역과 같은 글)
 *   - 맨 아래 날짜 'YYYY년  MM 월  DD 일'
 * 필요한 라이브러리: CFB(SheetJS cfb, 가짜 스트림 추가 막은 수정본), pako
 * 브라우저(window.CFB, window.pako)와 Node(require) 양쪽에서 동작.
 */
(function (root) {
  const T = { CHAR_SHAPE: 21, PARA_HEADER: 66, PARA_TEXT: 67, PARA_CHAR_SHAPE: 68, PARA_LINE_SEG: 69 };
  // 8글자(16바이트) 크기 제어문자 (확장/인라인 컨트롤)
  const WIDE_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

  const u8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  function readRecords(buf) {
    const recs = []; const v = dv(buf); let off = 0;
    while (off + 4 <= buf.length) {
      const h = v.getUint32(off, true); off += 4;
      const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff; let size = h >>> 20;
      if (size === 0xfff) { size = v.getUint32(off, true); off += 4; }
      recs.push({ tag, level, body: buf.slice(off, off + size) }); off += size;
    }
    return recs;
  }
  function writeRecords(recs) {
    let total = 0;
    for (const r of recs) total += 4 + (r.body.length >= 0xfff ? 4 : 0) + r.body.length;
    const out = new Uint8Array(total); const v = dv(out); let off = 0;
    for (const r of recs) {
      const big = r.body.length >= 0xfff;
      v.setUint32(off, (r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | ((big ? 0xfff : r.body.length) << 20) >>> 0, true); off += 4;
      if (big) { v.setUint32(off, r.body.length, true); off += 4; }
      out.set(r.body, off); off += r.body.length;
    }
    return out;
  }

  // PARA_TEXT → [{ctrl:bytes}|{ch:string}] 조각, 끝의 문단끝(13) 제외
  function splitText(body) {
    const v = dv(body); const parts = []; let i = 0;
    while (i + 1 < body.length) {
      const c = v.getUint16(i, true);
      if (c < 32 && WIDE_CTRL.has(c)) { parts.push({ ctrl: body.slice(i, i + 16) }); i += 16; continue; }
      if (c === 13) break;
      parts.push({ ch: String.fromCharCode(c) }); i += 2;
    }
    return parts;
  }
  const plain = (parts) => parts.map((p) => p.ch || '').join('');
  function joinText(parts) {
    const n = parts.reduce((a, p) => a + (p.ctrl ? 8 : 1), 0) + 1;
    const out = new Uint8Array(n * 2); const v = dv(out); let o = 0;
    for (const p of parts) { if (p.ctrl) { out.set(p.ctrl, o); o += 16; } else { v.setUint16(o, p.ch.charCodeAt(0), true); o += 2; } }
    v.setUint16(o, 13, true);
    return { bytes: out, nChars: n };
  }

  // DocInfo 의 글자모양: 기준 크기와 한글 장평/자간 (줄 나눔 추정용)
  function charShapes(docInfo) {
    return readRecords(docInfo).filter((r) => r.tag === T.CHAR_SHAPE).map((r) => {
      const v = dv(r.body);
      return { size: v.getInt32(42, true) || 1000, ratio: r.body[14] || 100, spacing: v.getInt8(21) };
    });
  }

  // 문단 단위로 묶기
  function paragraphs(recs) {
    const paras = [];
    recs.forEach((r, i) => {
      if (r.tag === T.PARA_HEADER) paras.push({ hi: i, level: r.level });
      else if (paras.length) {
        const p = paras[paras.length - 1];
        if (r.level === p.level + 1) {
          if (r.tag === T.PARA_TEXT) p.ti = i; else if (r.tag === T.PARA_CHAR_SHAPE) p.ci = i; else if (r.tag === T.PARA_LINE_SEG) p.li = i;
        }
      }
    });
    for (const p of paras) p.text = p.ti != null ? plain(splitText(recs[p.ti].body)) : '';
    return paras;
  }

  // 문단 글자 바꾸기: keepCtrl=앞쪽 컨트롤 유지, prefix=유지할 앞 글자
  function setParagraph(recs, p, newPlain, shapes, opt = {}) {
    const parts = recs[p.ti] ? splitText(recs[p.ti].body) : [];
    const ctrls = opt.keepCtrl ? parts.filter((x) => x.ctrl) : [];
    const chars = Array.from(String(newPlain).replace(/\r?\n/g, ' ')).map((ch) => ({ ch }));
    // 서로게이트(이모지 등)는 2글자로 저장
    const flat = [];
    for (const c of chars) for (let k = 0; k < c.ch.length; k++) flat.push({ ch: c.ch[k] });
    const newParts = [...ctrls, ...flat];
    const { bytes, nChars } = joinText(newParts);
    recs[p.ti].body = bytes;
    const head = new Uint8Array(recs[p.hi].body); const hv = dv(head);
    hv.setUint32(0, ((hv.getUint32(0, true) & 0x80000000) | nChars) >>> 0, true);

    // 글자모양: 새 길이 안쪽 것만 (첫 구간은 항상 유지)
    if (p.ci != null) {
      const cb = recs[p.ci].body, cv = dv(cb); const runs = [];
      for (let o = 0; o + 8 <= cb.length; o += 8) runs.push([cv.getUint32(o, true), cv.getUint32(o + 4, true)]);
      const keep = runs.filter((r, i) => i === 0 || r[0] < nChars - 1);
      const nb = new Uint8Array(keep.length * 8); const nv = dv(nb);
      keep.forEach((r, i) => { nv.setUint32(i * 8, r[0], true); nv.setUint32(i * 8 + 4, r[1], true); });
      recs[p.ci].body = nb; hv.setUint16(12, keep.length, true);
      p.shape = shapes[keep[keep.length - 1][1]] || shapes[keep[0][1]];
    }
    // 줄 정보: 칸 너비와 글자 크기로 줄 바꿈 위치를 추정해 다시 만듦 (한글이 열 때 다시 배치함)
    if (p.li != null) {
      const lb = recs[p.li].body, lv = dv(lb); const n = Math.floor(lb.length / 36);
      const seg = (k) => lb.slice(k * 36, k * 36 + 36);
      const s0 = seg(0), s1 = n > 1 ? seg(1) : null;
      const d0 = dv(s0);
      const width = d0.getInt32(28, true);
      const step = s1 ? dv(s1).getInt32(4, true) - d0.getInt32(4, true) : d0.getInt32(8, true) + d0.getInt32(20, true);
      const sh = p.shape || { size: 1000, ratio: 100, spacing: 0 };
      const full = sh.size * (sh.ratio / 100) * (1 + sh.spacing / 100);
      const starts = [0]; let w = 0; let pos = ctrls.length * 8;
      for (const c of flat) {
        const code = c.ch.charCodeAt(0);
        const cw = code >= 0x1100 ? full : code === 32 ? full * 0.5 : full * 0.55;
        if (w + cw > width && w > 0) { starts.push(pos); w = 0; }
        w += cw; pos += 1;
      }
      const nb = new Uint8Array(starts.length * 36); const nv = dv(nb);
      starts.forEach((st, k) => {
        nb.set(k === 0 ? s0 : (s1 || s0), k * 36);
        nv.setUint32(k * 36, st, true);
        nv.setInt32(k * 36 + 4, d0.getInt32(4, true) + step * k, true);
      });
      recs[p.li].body = nb; hv.setUint16(16, starts.length, true);
    }
    recs[p.hi].body = head;
  }

  function lib(env) {
    return { CFB: env.CFB || root.CFB, pako: env.pako || root.pako };
  }
  function getStream(CFB, cfb, name) {
    const e = CFB.find(cfb, 'Root Entry/' + name) || CFB.find(cfb, name);
    return e ? u8(e.content) : null;
  }
  function setStream(CFB, cfb, name, bytes) {
    const e = CFB.find(cfb, 'Root Entry/' + name) || CFB.find(cfb, name);
    e.content = bytes; e.size = bytes.length;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  /** 양식이 맞는지 확인하고 바꿀 곳을 찾음 */
  function locate(paras) {
    const repairLabel = paras.findIndex((p) => p.text.replace(/\s/g, '') === '수리내역');
    const find = (re) => paras.find((p) => re.test(p.text));
    return {
      repair: repairLabel >= 0 ? paras.slice(repairLabel + 1).find((p) => p.ti != null) : null,
      location: find(/^\s*1\.\s*누수\s*발생\s*위치\s*[:：]/),
      cause: find(/^\s*2\.\s*누수\s*발생\s*원인\s*[:：]/),
      date: find(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/),
    };
  }

  async function fillOpinion(templateBuf, data, env = {}) {
    const { CFB, pako } = lib(env);
    const cfb = CFB.read(u8(templateBuf), { type: 'array' });
    const header = getStream(CFB, cfb, 'FileHeader');
    if (!header || String.fromCharCode(...header.slice(0, 17)) !== 'HWP Document File') throw new Error('한글(HWP) 파일이 아닙니다');
    const flags = dv(header).getUint32(36, true);
    if (flags & 2) throw new Error('암호가 걸린 한글 파일은 쓸 수 없습니다');
    const compressed = (flags & 1) === 1;
    const raw = getStream(CFB, cfb, 'BodyText/Section0');
    const sec = compressed ? pako.inflateRaw(raw) : raw;
    const recs = readRecords(sec);
    const shapes = charShapes(compressed ? pako.inflateRaw(getStream(CFB, cfb, 'DocInfo')) : getStream(CFB, cfb, 'DocInfo'));
    const paras = paragraphs(recs);
    const at = locate(paras);
    const miss = Object.entries(at).filter(([, p]) => !p).map(([k]) => ({ repair: '수리 내역 칸', location: '1. 누수 발생 위치', cause: '2. 누수 발생 원인', date: '날짜(○○○○년 ○월 ○일)' }[k]));
    if (miss.length) throw new Error('소견서 양식에서 이 부분을 찾지 못했습니다: ' + miss.join(', '));

    const old = { repair: at.repair.text, location: at.location.text, cause: at.cause.text, date: at.date.text };
    const repair = String(data.repair || '').trim();
    const loc = String(data.location || '').trim();
    const locPrefix = at.location.text.match(/^\s*1\.\s*누수\s*발생\s*위치\s*[:：]\s*/)[0];
    const causePrefix = at.cause.text.match(/^\s*2\.\s*누수\s*발생\s*원인\s*[:：]\s*/)[0];
    const [y, m, d] = String(data.date || '').split('-');
    const dateText = at.date.text.replace(/(\d{4})(\s*년\s*)(\d{1,2})(\s*월\s*)(\d{1,2})(\s*일)/, `${y}$2${pad2(m)}$4${pad2(d)}$6`);

    setParagraph(recs, at.repair, repair, shapes);
    setParagraph(recs, at.location, locPrefix + loc, shapes);
    setParagraph(recs, at.cause, causePrefix + (data.cause != null ? String(data.cause).trim() : repair), shapes);
    setParagraph(recs, at.date, dateText, shapes, { keepCtrl: true });

    const body = writeRecords(recs);
    setStream(CFB, cfb, 'BodyText/Section0', compressed ? pako.deflateRaw(body, { level: 9 }) : body);

    // 미리보기 글(탐색기 미리보기용)도 바꿔 둠
    const prv = getStream(CFB, cfb, 'PrvText');
    if (prv) {
      let t = ''; const v = dv(prv); for (let i = 0; i + 1 < prv.length; i += 2) t += String.fromCharCode(v.getUint16(i, true));
      const neu = { repair, location: locPrefix + loc, cause: causePrefix + (data.cause != null ? data.cause : repair), date: dateText };
      for (const k of Object.keys(old)) {
        const plainOld = old[k].replace(/[\u0000-\u001f]/g, '');
        if (plainOld) t = t.split(plainOld).join(neu[k].replace(/[\u0000-\u001f]/g, ''));
      }
      const nb = new Uint8Array(t.length * 2); const nv = dv(nb);
      for (let i = 0; i < t.length; i++) nv.setUint16(i * 2, t.charCodeAt(i), true);
      setStream(CFB, cfb, 'PrvText', nb);
    }
    const out = CFB.write(cfb, { type: 'array', fileType: 'cfb' });
    return u8(out);
  }

  /** 올린 파일이 소견서 양식인지 확인 (바꿀 4곳이 있는지) */
  function checkOpinionTemplate(buf, env = {}) {
    const { CFB, pako } = lib(env);
    const cfb = CFB.read(u8(buf), { type: 'array' });
    const header = getStream(CFB, cfb, 'FileHeader');
    if (!header || String.fromCharCode(...header.slice(0, 17)) !== 'HWP Document File') return { ok: false, why: '한글(.hwp) 파일이 아닙니다' };
    const flags = dv(header).getUint32(36, true);
    const raw = getStream(CFB, cfb, 'BodyText/Section0');
    const at = locate(paragraphs(readRecords((flags & 1) ? pako.inflateRaw(raw) : raw)));
    const miss = Object.entries(at).filter(([, p]) => !p).map(([k]) => k);
    return miss.length ? { ok: false, why: '소견서 양식이 아닌 것 같습니다 (못 찾은 곳: ' + miss.join(', ') + ')' } : { ok: true };
  }

  const api = { fillOpinion, checkOpinionTemplate, _internal: { readRecords, paragraphs, splitText, plain } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Hwp5 = api;
})(typeof window !== 'undefined' ? window : globalThis);
