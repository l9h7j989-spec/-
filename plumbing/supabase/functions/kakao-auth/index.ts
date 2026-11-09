// 앱에서 카카오 로그인 후 받은 code 를 토큰으로 바꿔 서버에 저장한다.
import { adminClient, cors, json, userFromRequest } from "../_shared/supa.ts";
import { exchangeCode } from "../_shared/kakao.ts";

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
