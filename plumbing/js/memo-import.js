/* 메모 가져오기: 날짜별로 적어 둔 작업 메모(텍스트/HTML)를 날짜 기록으로 나눈다.
 * 날짜 줄 모양: "3/24", "3/24 - 175", "4/4  수입 90", "2023년 12월 18일 월"
 * 날짜 줄 다음 줄들 = 그날 기록. 첫 날짜 앞의 글(예: "23WORK")은 버린다.
 * 연도: 첫 연도를 정해 주면, 월이 크게 줄어들 때(12월 → 1월) 다음 해로 넘긴다. "2023년 ..." 처럼 연도가 적힌 줄은 그 연도를 쓴다.
 */
(function (root) {
  function htmlToText(s) {
    if (!/<\s*(br|p|div|body|html)\b/i.test(s)) return s;
    return s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|tr|h\d)\s*>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  const pad = (n) => String(n).padStart(2, '0');
  const FULL = /^\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(.*)$/;
  const SHORT = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])\s*(.*)$/;

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
      if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); rest = m[4]; year = y; }
      else if ((m = t.match(SHORT)) && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) {
        mo = Number(m[1]); d = Number(m[2]); rest = m[3];
        if (prevMonth != null && mo < prevMonth - 6) year++; // 12월 → 1월 처럼 해가 바뀜
        y = year;
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
      if (s) cur.lines.push(s);
    }
    const out = [...byDate.values()].map((e) => ({ date: e.date, lines: [...e.lines, ...(e.tail || [])] }));
    return out.filter((e) => e.lines.length).sort((a, b) => a.date.localeCompare(b.date));
  }

  const api = { parseMemo, guessYear, htmlToText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
