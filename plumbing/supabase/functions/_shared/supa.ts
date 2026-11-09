import { createClient } from "npm:@supabase/supabase-js@2.118.0";

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
