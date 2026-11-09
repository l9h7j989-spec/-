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
