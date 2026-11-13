/*
 * config.js — 모든 기기에서 똑같이 쓰는 값
 *
 * 아래 두 칸에 Supabase 프로젝트의 주소와 공개 키를 넣어 두면, 어느 기기에서든
 * 사이트를 열고 이메일·비밀번호로 한 번 로그인하면 계속 로그인된 채로
 * 거래처·견적·카카오 키·사무실·견적서 양식이 모두 따라옵니다.
 *
 * 공개 키(anon 또는 publishable)는 브라우저에 넣어도 되는 키입니다.
 * service_role / secret 키는 절대 넣지 마세요.
 */
window.AppConfig = {
  SUPABASE_URL: '',       // 예: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: ''   // 공개 키 (anon 또는 sb_publishable_...)
};
