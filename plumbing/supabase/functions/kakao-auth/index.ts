// ============================================================
// kakao-auth — Supabase Edge Function (이 파일 하나로 완성. 대시보드 편집기에 통째로 붙여넣기)
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

// ── 본체 ──
// 앱에서 카카오 로그인 후 받은 code 를 토큰으로 바꿔 서버에 저장한다.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await userFromRequest(req);
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);
    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) return json({ error: "code, redirect_uri 가 필요합니다" }, 400);
    const t = await exchangeCode(code, redirect_uri);
    if (!t.refresh_token) return json({ error: "리프레시 토큰을 받지 못했습니다" }, 400);
    const now = Date.now();
    const { error } = await adminClient().from("kakao_tokens").upsert({
      user_id: user.id,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
      refresh_expires_at: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
