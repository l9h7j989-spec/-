/* 견적 계산·문장 해석 (UI 없음, Node 테스트 가능) */
(function (root) {
  const UNITS = ['식', '개소', '개', 'EA', 'ea', 'm', 'M', '미터', '㎡', 'm2', '평', '곳', '회', '대', '본', 'set', 'SET', '세트', '시간', '일', '인', '롤', '박스', 'kg'];
  const unitRe = UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // "15만", "15만원", "150,000", "1.5만", "3천" → 숫자
  function parseMoney(s) {
    if (s == null) return NaN;
    s = String(s).replace(/[,\s원₩￦]/g, '');
    let m = s.match(/^(\d+(?:\.\d+)?)만(\d+(?:\.\d+)?천)?$/);
    if (m) return Math.round(parseFloat(m[1]) * 10000 + (m[2] ? parseFloat(m[2]) * 1000 : 0));
    m = s.match(/^(\d+(?:\.\d+)?)천$/);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
    return /^\d+(\.\d+)?$/.test(s) ? Math.round(parseFloat(s)) : NaN;
  }

  const won = (n) => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');

  // 숫자 → 한글 금액 (일금 ○○원정)
  function toKoreanMoney(n) {
    n = Math.floor(Number(n) || 0);
    if (n === 0) return '영';
    const d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const small = ['', '십', '백', '천'];
    const big = ['', '만', '억', '조'];
    let out = '';
    let gi = 0;
    while (n > 0) {
      const chunk = n % 10000;
      if (chunk) {
        let s = '';
        let c = chunk;
        for (let i = 0; i < 4 && c > 0; i++) {
          const v = c % 10;
          if (v) s = d[v] + small[i] + s;
          c = Math.floor(c / 10);
        }
        out = s + big[gi] + out;
      }
      n = Math.floor(n / 10000);
      gi++;
    }
    return out;
  }

  // 한 줄 → 품목 (실패 시 null)
  // 예) "PB관 교체 15A 5m 12000" / "누수탐지 1식 15만" / "변기 교체 1개 단가 80000 비고 자재포함"
  function parseItemLine(line) {
    let s = line.replace(/^[-*•·\d]+[.)]\s*/, '').trim();
    if (!s) return null;
    let note = '';
    const nm = s.match(/\s(?:비고|메모)[:\s]\s*(.+)$/) || s.match(/\(([^)]*)\)\s*$/);
    if (nm) { note = nm[1].trim(); s = s.slice(0, nm.index).trim(); }
    // 마지막 금액
    const pm = s.match(/(?:단가|@)?\s*(\d[\d,]*(?:\.\d+)?\s*(?:만(?:\s*\d+천)?|천)?)\s*원?\s*$/);
    if (!pm) return null;
    const price = parseMoney(pm[1]);
    if (!(price > 0)) return null;
    s = s.slice(0, pm.index).replace(/(단가|@)\s*$/, '').trim();
    // 수량+단위 (끝쪽 우선)
    let qty = '', unit = ''; // 엑셀 양식처럼 안 적으면 비워 둠 (금액은 수량 1로 계산)
    const qm = s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + unitRe + ')\\s*$')) ||
      s.match(new RegExp('(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*(' + unitRe + ')(?=\\s|$)'));
    if (qm) {
      qty = parseFloat(qm[1]); unit = qm[2] === 'M' || qm[2] === '미터' ? 'm' : qm[2];
      s = (s.slice(0, qm.index) + ' ' + s.slice(qm.index + qm[0].length)).trim();
    } else {
      const xm = s.match(/[x×*]\s*(\d+(?:\.\d+)?)\s*$/);
      if (xm) { qty = parseFloat(xm[1]); unit = '개'; s = s.slice(0, xm.index).trim(); }
    }
    // 규격 (15A, 20mm, φ50, 50A, 1/2", DN25)
    let spec = '';
    const sm = s.match(/(?:^|\s)((?:φ|Ø|DN)?\d+(?:\.\d+)?(?:A|mm|㎜|파이|인치|")|\d\/\d"?|(?:φ|Ø|DN)\d+)(?=\s|$)/);
    if (sm) { spec = sm[1]; s = (s.slice(0, sm.index) + ' ' + s.slice(sm.index + sm[0].length)).trim(); }
    const name = s.replace(/\s{2,}/g, ' ').trim();
    if (!name) return null;
    return { name, spec, qty, unit, price, note };
  }

  const FIELD_KEYS = {
    customer: ['고객', '고객명', '이름', '성함', '수신', '건축주', '의뢰인'],
    phone: ['전화', '연락처', '핸드폰', '휴대폰', '번호'],
    address: ['주소', '현장', '현장주소', '위치'],
    title: ['공사', '공사명', '건명', '제목', '작업', '내용'],
    memo: ['메모', '특기', '특기사항', '참고', '비고'],
    date: ['날짜', '견적일', '일자'],
  };

  // 자유 텍스트 → { fields, items, vatMode, unparsed }
  function parseEstimateText(text) {
    const fields = {};
    const items = [];
    const unparsed = [];
    const memo = [];
    let vatMode = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/부가세|VAT|vat/.test(line) && line.length < 25) {
        if (/별도|미포함|추가/.test(line)) vatMode = 'separate';
        else if (/포함/.test(line)) vatMode = 'included';
        else if (/없음|면세|제외|안/.test(line)) vatMode = 'none';
        continue;
      }
      const kv = line.match(/^([가-힣A-Za-z]{1,6})\s*[:：]\s*(.+)$/);
      if (kv) {
        const key = Object.keys(FIELD_KEYS).find((k) => FIELD_KEYS[k].includes(kv[1]));
        if (key === 'memo') { memo.push(kv[2].trim()); continue; }
        if (key) {
          let v = kv[2].trim();
          const ph2 = v.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
          if (ph2 && key !== 'phone') { fields.phone = fields.phone || ph2[0]; v = v.replace(ph2[0], '').replace(/[,/]\s*$/, '').trim(); }
          fields[key] = v; continue;
        }
      }
      const ph = line.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
      if (ph && !fields.phone) {
        fields.phone = ph[0].replace(/[\s.]/g, '-');
        const rest = line.replace(ph[0], '').replace(/[,/]/g, ' ').trim();
        if (rest && !fields.customer && rest.length <= 10) fields.customer = rest.replace(/(님|고객님?)$/, '');
        else if (rest) unparsed.push(rest);
        continue;
      }
      const it = parseItemLine(line);
      if (it) { items.push(it); continue; }
      if (!fields.address && /(시|도|구|군|동|읍|면|로|길)\s*\d|아파트|빌라|동\s*\d+호|\d+호/.test(line)) {
        fields.address = line; continue;
      }
      unparsed.push(line);
    }
    if (memo.length) fields.memo = memo.join('\n');
    if (fields.phone) {
      const d = fields.phone.replace(/\D/g, '');
      if (d.length === 11) fields.phone = d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    return { fields, items, vatMode, unparsed };
  }

  // 수량을 안 적으면 1로 계산 (엑셀 PRODUCT 와 같음)
  const lineAmount = (it) => Math.round((Number(it.qty) || 1) * (Number(it.price) || 0));

  // 사장님 양식: 합계 = 품목 합계. 부가세는 '별도/포함' 문구로만 표시하고 더하지 않음
  function calcTotals(items, vatMode) {
    const sum = items.reduce((a, it) => a + (it.price ? lineAmount(it) : 0), 0);
    let supply = sum, vat = 0;
    if (vatMode === 'included') { supply = Math.round(sum / 1.1); vat = sum - supply; }
    return { supply, vat, total: sum };
  }

  const VAT_LABEL = { separate: '별도', included: '포함', none: '없음' };
  const MIN_ROWS = 12; // 양식처럼 빈 줄을 채워 최소 줄 수 맞춤

  // 양식에 넣을 값 묶음
  function buildTemplateData(est, company) {
    const t = calcTotals(est.items, est.vatMode);
    const [y, m, d] = String(est.date || '').split('-');
    const data = {
      year: y || '', month: m || '', day: d || '',
      site: est.address || est.customer || '', company_tel: company.tel || '',
      date: est.date || '', customer: est.customer || '', phone: est.phone || '',
      address: est.address || '', title: est.title || '', memo: est.memo || '',
      valid_days: String(est.validDays || 30),
      company: company.name || '', owner: company.owner || '', bizno: company.bizno || '',
      company_phone: company.phone || '', company_address: company.address || '',
      account: company.account || '',
      supply: won(t.supply), vat: won(t.vat), total: won(t.total),
      total_korean: toKoreanMoney(t.total),
      vat_label: VAT_LABEL[est.vatMode] || '별도',
    };
    // 한글 키 별칭 (사용자 양식용)
    Object.assign(data, {
      견적일: data.date, 고객: data.customer, 연락처: data.phone, 주소: data.address,
      공사명: data.title, 특기사항: data.memo, 상호: data.company, 대표: data.owner,
      사업자번호: data.bizno, 업체전화: data.company_phone, 업체주소: data.company_address,
      계좌: data.account, 공급가액: data.supply, 부가세: data.vat, 합계: data.total,
      합계한글: data.total_korean, 현장: data.site, 년: data.year, 월: data.month, 일: data.day,
    });
    const items = est.items.map((it, i) => ({
      no: String(i + 1), name: [it.name, it.spec].filter(Boolean).join(' '), spec: it.spec || '',
      qty: it.qty === '' || it.qty == null ? '' : String(it.qty), unit: it.unit || '',
      price: it.price ? won(it.price) : '', amount: it.price ? won(lineAmount(it)) : '',
      note: it.note || '',
    }));
    while (items.length < MIN_ROWS) items.push({ no: '', name: '', spec: '', qty: '', unit: '', price: '', amount: '', note: '' });
    return { data, items, totals: t };
  }

  const api = { lineAmount, parseMoney, won, toKoreanMoney, parseItemLine, parseEstimateText, calcTotals, buildTemplateData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EstCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
