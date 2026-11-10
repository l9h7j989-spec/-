/* 메모 가져오기: 날짜별로 적어 둔 작업 메모(텍스트/HTML)를 날짜 기록으로 나눈다.
 * 날짜 줄 모양: "3/24", "3/24 - 175", "4/4  수입 90", "2023년 12월 18일 월", "2025 11월 17일", "2025 12월 30", "2025.1.3", "1월 3일"
 * 날짜 줄 다음 줄들 = 그날 기록. 첫 날짜 앞의 글(예: "23WORK")은 버린다.
 * 날짜처럼 보여도 날짜 줄이 아닌 것: "12/20일로 다시 진행"(내용), "1/1-6 87"(주간 합계)
 * 기간 합계 줄("Total 56", "=925", "4월 212", "총 수익 = 775", 하루 숫자 뒤의 주간 합계 숫자)은 버린다.
 * 연도: 첫 연도를 정해 주면, 월이 크게 줄어들 때(12월 → 1월) 다음 해로 넘긴다. 연도가 적힌 줄은 그 연도를 쓴다.
 */
(function (root) {
  function htmlToText(s) {
    if (!/<\s*(br|p|div|body|html)\b/i.test(s)) return s;
    return s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|tr|h\d)\s*>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  const pad = (n) => String(n).padStart(2, '0');
  // 2023년 12월 18일 / 2025 11월 17일 / 2025 12월 30 / 2025.1.3 / 2025-01-03
  const FULL = /^\s*(\d{4})\s*(?:년|[.\-/])?\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})(?!\d)\s*(?:일)?\s*(.*)$/;
  const MD = /^\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?![가-힣])\s*(.*)$/; // 1월 3일
  // 3/24, 3/24 - 175, 3/24(금) — "12/20일로…"(바로 글자), "1/1-6 87"(기간)은 날짜 줄 아님
  const SHORT = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/]|\s*[-~]\s*\d{1,2}\s+[\d.,]+\s*$|[가-힣A-Za-z])\s*(.*)$/;
  // 기간 합계 줄: 기록이 아니라 메모 주인이 적은 합계
  const SUMMARY = [
    /^(total|합계|총)\b/i, /^total/i, /총.{0,6}(수익|합|월급)/, /^총\s*[\d,.]+/,
    /^=\s*[\d,.]+\s*(만원)?\s*$/,
    /^\d{1,2}\s*월\s*(월급\s*)?[\d,.]+\s*(만원)?\s*$/,
    /^\d{1,2}\s*\/\s*\d{1,2}\s*[-~]\s*\d{1,2}\s+[\d.,]+\s*$/, // 1/1-6 87
    /^\d{1,2}\s*[-~]\s*\d{1,2}\s+[\d.,]+\s*$/, // 3-4 30
  ];
  const LONE = /^[\d.,]+\s*(\([^)]*\))?$/; // "13", "15(현)" — 그날 일당 같은 숫자
  const validDay = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(y, mo, 0).getDate();

  function guessYear(text) {
    const m = text.match(/(\d{4})\s*년\s*\d{1,2}\s*월/) || text.match(/(?:^|\D)(\d{2})\s*WORK/i);
    if (!m) return null;
    return m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  }

  /** @returns [{ date:'YYYY-MM-DD', lines:[...] }] (날짜 순, 같은 날은 합침) */
  function parseMemo(raw, startYear) {
    const text = htmlToText(String(raw || ''));
    let year = Number(startYear) || guessYear(text) || new Date().getFullYear();
    let prevMonth = null; let cur = null; const byDate = new Map();
    for (const line of text.split(/\r?\n/)) {
      const t = line.replace(/\s+$/, '');
      let m = t.match(FULL), y, mo, d, rest;
      if (m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 && validDay(Number(m[1]), Number(m[2]), Number(m[3])) && /^([월화수목금토일](요일)?)?\s*$|^[(\-=\s]/.test(m[4] || '')) {
        y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); rest = m[4]; year = y;
      } else if (((m = t.match(MD)) || (m = t.match(SHORT)))) {
        const mm = Number(m[1]), dd = Number(m[2]);
        let yy = year;
        if (prevMonth != null && mm < prevMonth - 6) yy++; // 12월 → 1월 처럼 해가 바뀜
        if (validDay(yy, mm, dd)) { mo = mm; d = dd; rest = m[3]; year = yy; y = yy; }
      }
      if (mo) {
        prevMonth = mo;
        const date = `${y}-${pad(mo)}-${pad(d)}`;
        cur = byDate.get(date) || { date, lines: [] };
        byDate.set(date, cur);
        const r = (rest || '').trim();
        if (r && !/^[월화수목금토일](요일)?$/.test(r) && !/^[-=\s]*$/.test(r)) (cur.tail = cur.tail || []).push(r); // "- 175", "수입 90" 같은 메모는 그날 기록 끝에 붙임
        continue;
      }
      if (!cur) continue; // 첫 날짜 앞의 글
      const s = t.trim();
      if (!s) continue;
      if (SUMMARY.some((r) => r.test(s))) continue;
      // 하루 숫자(일당) 다음에 또 숫자만 있으면 주간 합계 → 버림
      if (LONE.test(s) && cur.lines.length && LONE.test(cur.lines[cur.lines.length - 1])) continue;
      cur.lines.push(s);
    }
    const out = [...byDate.values()].map((e) => ({ date: e.date, lines: [...e.lines, ...(e.tail || [])] }));
    return out.filter((e) => e.lines.length).sort((a, b) => a.date.localeCompare(b.date));
  }

  // 하루에 줄이 너무 많은 날(날짜 줄을 못 알아봐서 여러 날이 몰렸을 수 있음)
  function suspicious(entries, max = 30) { return entries.filter((e) => e.lines.length > max); }

  const api = { parseMemo, guessYear, htmlToText, suspicious };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
