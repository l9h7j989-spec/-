// ============================================================
// kakao-notify — Supabase Edge Function (이 파일 하나로 완성. 대시보드 편집기에 통째로 붙여넣기)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// ── 공통 ──

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** 서버 전용(모든 행 접근) 클라이언트. 새/옛 키 이름 모두 지원 */
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      key = keys.default || Object.values(keys)[0] as string || "";
    } catch { /* 무시 */ }
  }
  if (!key) throw new Error("서버 키를 찾지 못했습니다 (SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 요청한 사용자 확인 (앱 로그인 토큰) */
export async function userFromRequest(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// 카카오 토큰 발급/갱신, 나에게 보내기
const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";

export interface KakaoTokenResponse {
  access_token: string; expires_in: number;
  refresh_token?: string; refresh_token_expires_in?: number;
  error?: string; error_description?: string;
}

function form(params: Record<string, string | undefined>) {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) f.set(k, v);
  return f;
}

async function tokenRequest(params: Record<string, string | undefined>): Promise<KakaoTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: form(params),
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`카카오 토큰 오류: ${j.error_description || j.error || res.status}`);
  return j;
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({
    grant_type: "authorization_code",
    client_id: Deno.env.get("KAKAO_REST_KEY"),
    client_secret: Deno.env.get("KAKAO_CLIENT_SECRET"),
    redirect_uri: redirectUri, code,
  });

export const refreshToken = (refresh: string) =>
  tokenRequest({
    grant_type: "refresh_token",
    client_id: Deno.env.get("KAKAO_REST_KEY"),
    client_secret: Deno.env.get("KAKAO_CLIENT_SECRET"),
    refresh_token: refresh,
  });

export async function sendToMe(accessToken: string, text: string, appUrl: string) {
  const template = {
    object_type: "text",
    text,
    link: { web_url: appUrl, mobile_web_url: appUrl },
    button_title: "앱 열기",
  };
  const res = await fetch(MEMO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: form({ template_object: JSON.stringify(template) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.result_code !== undefined && j.result_code !== 0)) {
    throw new Error(`카톡 발송 실패: ${j.msg || j.code || res.status}`);
  }
}

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

// ── 본체 ──
// 미수금 카톡 알림
// - 매일 예약(cron): x-cron-secret 헤더로 호출 → 카카오 연결된 모든 사용자에게, 미수 있을 때만 발송
// - 앱의 [테스트 발송]: 로그인 토큰으로 호출 → 그 사용자에게 항상 발송

type Admin = ReturnType<typeof adminClient>;

async function validAccessToken(db: Admin, row: any): Promise<string> {
  const exp = row.access_expires_at ? Date.parse(row.access_expires_at) : 0;
  if (exp - Date.now() > 5 * 60_000) return row.access_token;
  const t = await refreshToken(row.refresh_token);
  const now = Date.now();
  const patch: Record<string, unknown> = {
    access_token: t.access_token,
    access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  // 리프레시 토큰이 갱신되어 오면 반드시 저장 (옛 것은 폐기됨)
  if (t.refresh_token) {
    patch.refresh_token = t.refresh_token;
    if (t.refresh_token_expires_in) patch.refresh_expires_at = new Date(now + t.refresh_token_expires_in * 1000).toISOString();
  }
  await db.from("kakao_tokens").update(patch).eq("user_id", row.user_id);
  return t.access_token;
}

async function notifyUser(db: Admin, row: any, force: boolean) {
  const { data: settingsRow } = await db.from("records").select("data")
    .eq("user_id", row.user_id).eq("kind", "settings").eq("id", "main").maybeSingle();
  const notify = (settingsRow?.data?.notify) || {};
  if (!force && notify.enabled === false) return "알림 꺼짐";
  const minDays = Number(notify.days) || 7;

  const jobs: Job[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("records").select("data")
      .eq("user_id", row.user_id).eq("kind", "jobs").eq("deleted", false).range(from, from + 999);
    if (error) throw error;
    data.forEach((r: any) => r.data && jobs.push(r.data));
    if (data.length < 1000) break;
  }
  const items = findUnpaid(jobs, minDays, kstToday());
  if (!items.length && !force) return "미수 없음(발송 안 함)";

  const token = await validAccessToken(db, row);
  const appUrl = Deno.env.get("APP_URL") || "https://example.com";
  const msgs = buildMessages(items, minDays);
  for (const m of msgs.slice(0, 5)) await sendToMe(token, m, appUrl); // 최대 5통
  return `${items.length}건 / ${Math.min(msgs.length, 5)}통 발송`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = adminClient();
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  let rows: any[] = [];
  if (isCron) {
    const { data, error } = await db.from("kakao_tokens").select("*");
    if (error) return json({ error: error.message }, 500);
    rows = data;
  } else {
    const user = await userFromRequest(req);
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);
    const { data } = await db.from("kakao_tokens").select("*").eq("user_id", user.id).maybeSingle();
    if (!data) return json({ error: "카카오가 연결되어 있지 않습니다" }, 400);
    rows = [data];
  }
  const results: Record<string, string> = {};
  for (const row of rows) {
    let result: string;
    try { result = await notifyUser(db, row, !isCron); }
    catch (e) { result = "오류: " + (e as Error).message; }
    results[row.user_id] = result;
    await db.from("kakao_tokens").update({ last_sent_at: new Date().toISOString(), last_result: result.slice(0, 300) })
      .eq("user_id", row.user_id);
  }
  return json(isCron ? { ok: true, count: rows.length } : { ok: true, result: Object.values(results)[0] });
});
