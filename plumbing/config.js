// 배포할 때 한 번만 채우면 모든 기기에서 자동으로 쓰인다. (비워두면 앱 설정 화면에서 입력)
// supabaseAnonKey 는 공개용 키(anon / publishable)라 여기에 적어도 된다. service_role(비밀 키)은 절대 넣지 말 것.
window.APP_CONFIG = {
  supabaseUrl: '',      // 예: https://abcdefgh.supabase.co
  supabaseAnonKey: '',  // Supabase → Project Settings → API Keys 의 anon(또는 publishable) 키
  kakaoRestKey: '',     // 카카오 디벨로퍼스 → 앱 → 플랫폼 키 → REST API 키
};
