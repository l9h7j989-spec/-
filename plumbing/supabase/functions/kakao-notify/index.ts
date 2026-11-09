// 미수금 카톡 알림
// - 매일 예약(cron): x-cron-secret 헤더로 호출 → 카카오 연결된 모든 사용자에게, 미수 있을 때만 발송
// - 앱의 [테스트 발송]: 로그인 토큰으로 호출 → 그 사용자에게 항상 발송
import { adminClient, cors, json, userFromRequest } from "../_shared/supa.ts";
import { refreshToken, sendToMe } from "../_shared/kakao.ts";
import { buildMessages, findUnpaid, Job, kstToday } from "../_shared/unpaid.ts";

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
