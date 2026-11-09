// 미수금 계산 + 카톡 메시지 만들기 (순수 함수: 테스트 가능)

export interface Job {
  id: string; date: string; customer?: string; phone?: string; type?: string;
  amount?: number | string; paid?: number | string;
}
export interface UnpaidItem { job: Job; unpaid: number; days: number }

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 한국 날짜(YYYY-MM-DD) */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400_000);
}

/** 작업일로부터 minDays 일 이상 지났는데 돈을 다 못 받은 작업 (오래된 순) */
export function findUnpaid(jobs: Job[], minDays: number, today: string): UnpaidItem[] {
  return jobs
    .map((job) => {
      const amount = Number(job.amount) || 0, paid = Number(job.paid) || 0;
      return { job, unpaid: amount - paid, days: job.date ? daysBetween(job.date, today) : -1 };
    })
    .filter((x) => x.unpaid > 0 && x.days >= minDays)
    .sort((a, b) => b.days - a.days);
}

const MAX = 200; // 카카오 텍스트 템플릿 글자 수 한도

/** 카톡 메시지들 (한 통 200자 이하로 나눔) */
export function buildMessages(items: UnpaidItem[], minDays: number): string[] {
  const total = items.reduce((a, x) => a + x.unpaid, 0);
  if (!items.length) return [`[미수금 알림]\n${minDays}일 넘게 입금 안 된 작업이 없습니다 👍`];
  const head = `[미수금 알림] ${minDays}일 이상 미입금 ${items.length}건\n합계 ${won(total)}원`;
  const lines = items.map((x, i) => {
    const d = x.job.date.slice(5).replace("-", "/");
    const name = (x.job.customer || "고객없음").slice(0, 10);
    const type = (x.job.type || "").slice(0, 8);
    return `${i + 1}) ${d} ${name} ${type} ${won(x.unpaid)}원 (${x.days}일)`.slice(0, MAX);
  });
  const msgs: string[] = [];
  let cur = head;
  for (const l of lines) {
    if ((cur + "\n" + l).length > MAX) { msgs.push(cur); cur = l; } else cur += "\n" + l;
  }
  msgs.push(cur);
  if (msgs.length > 1) return msgs.map((m, i) => `(${i + 1}/${msgs.length}) ` + m).map((m) => m.slice(0, MAX));
  return msgs;
}
