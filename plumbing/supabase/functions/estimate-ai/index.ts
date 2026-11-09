// ============================================================
// estimate-ai — Supabase Edge Function (이 파일 하나로 완성. 대시보드 편집기에 통째로 붙여넣기)
// 카톡 대화·메모처럼 형식 없는 글을 읽고 견적서 칸(고객, 주소, 품목, 금액…)을 채운다.
// 필요한 비밀값: ANTHROPIC_API_KEY
// ============================================================
import Anthropic from "npm:@anthropic-ai/sdk@1.2.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** 로그인한 앱 사용자만 쓸 수 있게 (남이 친구 API 요금을 쓰지 못하도록) */
async function loggedIn(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const { data, error } = await createClient(url, key, { auth: { persistSession: false } }).auth.getUser(token);
  return !error && !!data.user;
}

// 결과 모양 (모든 칸 필수, 모르면 빈 값)
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customer", "phone", "address", "title", "date", "vatMode", "memo", "items", "questions"],
  properties: {
    customer: { type: "string", description: "고객 이름 또는 상호. 없으면 빈 문자열" },
    phone: { type: "string", description: "고객 연락처 010-0000-0000 형식. 없으면 빈 문자열" },
    address: { type: "string", description: "현장 주소. 없으면 빈 문자열" },
    title: { type: "string", description: "공사명 한 줄 요약 (예: 욕실 바닥 누수 보수)" },
    date: { type: "string", description: "견적일 YYYY-MM-DD. 글에 없으면 빈 문자열" },
    vatMode: { type: "string", enum: ["separate", "included", "none", ""], description: "부가세 별도/포함/없음. 언급 없으면 빈 문자열" },
    memo: { type: "string", description: "견적서 특기사항(하자보수 기간, 공사기간, 조건 등). 줄바꿈으로 구분" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "spec", "qty", "unit", "price", "note"],
        properties: {
          name: { type: "string", description: "품명/작업명" },
          spec: { type: "string", description: "규격 (15A, 20A, 50mm 등). 없으면 빈 문자열" },
          qty: { type: "number", description: "수량. 모르면 1" },
          unit: { type: "string", description: "단위 (식, 개, m, ㎡, 개소, 회 등). 모르면 식" },
          price: { type: "number", description: "단가(원, 정수). 글이나 단가표에 근거가 없으면 0" },
          note: { type: "string", description: "비고. 없으면 빈 문자열" },
        },
      },
    },
    questions: { type: "array", items: { type: "string" }, description: "사장님이 확인해야 할 점 (금액 미정, 수량 불명확 등). 없으면 빈 배열" },
  },
} as const;

const SYSTEM = `당신은 배관·누수 공사 사업자의 견적서 작성을 돕습니다.
사장님이 붙여넣는 글은 고객과의 카톡 대화, 문자, 전화 메모, 사장님 혼잣말 메모처럼 형식이 제각각입니다.
글을 읽고 견적서 칸을 채운 JSON만 돌려주세요.

규칙:
- 글에 없는 사실(이름, 주소, 금액)은 지어내지 마세요. 모르면 빈 값, 금액은 0 으로 두고 questions 에 "○○ 금액 확인 필요"처럼 적으세요.
- 품목 단가는 1) 글에 적힌 금액 2) 아래 '단가표'에 같은/비슷한 작업이 있으면 그 단가 순서로 씁니다. 단가표 단가를 썼다면 note 에 "단가표"라고 적으세요.
- "총 45만원에 해주기로"처럼 합계만 있고 나눌 근거가 없으면, 공사 내용을 품명으로 한 1식 품목 하나에 그 금액을 넣으세요. 임의로 쪼개지 마세요.
- "15만원씩 3군데"는 수량 3, 단가 150000 입니다. "3만5천" = 35000, "15만" = 150000.
- 고객이 보낸 말(증상 설명)과 사장님이 하겠다는 작업을 구분하고, 품목에는 실제 작업만 넣으세요.
- 부가세 언급이 없으면 vatMode 는 빈 문자열.
- 날짜는 오늘 날짜를 기준으로 "내일", "다음주 화요일" 같은 말을 실제 날짜로 바꾸되, 견적일(date)은 글에 견적 날짜가 분명할 때만 넣으세요.
- 고객 개인정보는 견적서에 필요한 이름·연락처·주소만 쓰세요.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await loggedIn(req))) return json({ error: "로그인이 필요합니다" }, 401);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "AI 키(ANTHROPIC_API_KEY)가 설정되지 않았습니다" }, 500);
    const { text, presets = [], today = "" } = await req.json();
    if (!text || typeof text !== "string") return json({ error: "글이 비어 있습니다" }, 400);
    if (text.length > 20000) return json({ error: "글이 너무 깁니다 (2만 자 이하)" }, 400);

    const priceList = (presets as Array<Record<string, unknown>>)
      .slice(0, 200)
      .map((p) => `- ${p.name}${p.spec ? ` (${p.spec})` : ""}: ${p.price}원 / ${p.unit || "식"}`)
      .join("\n") || "(없음)";

    const client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `오늘 날짜: ${today || new Date().toISOString().slice(0, 10)}\n\n[단가표]\n${priceList}\n\n[받은 글]\n${text}`,
      }],
    });

    if (res.stop_reason === "refusal") return json({ error: "AI가 이 글을 처리하지 않았습니다. 직접 입력해 주세요." }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "글이 너무 길어 처리하지 못했습니다. 나눠서 넣어주세요." }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "AI 응답이 비어 있습니다" }, 502);
    const result = JSON.parse(out.text);
    return json({ ok: true, result });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "AI 키가 잘못되었습니다 (ANTHROPIC_API_KEY 확인)" }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "AI 사용량 한도 초과. 잠시 후 다시 시도하세요." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 오류 (${e.status}): ${e.message}` }, 502);
    return json({ error: (e as Error).message }, 500);
  }
});
