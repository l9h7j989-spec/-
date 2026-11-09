# 설치·설정 안내 (처음 한 번만, 약 30~40분)

순서대로 하면 됩니다. 컴퓨터(PC)에서 하는 것을 권장합니다.

| 단계 | 하는 일 | 필요한 것 |
|---|---|---|
| 0 | 앱 주소 만들기 (휴대폰에서 열 주소) | GitHub (이미 있음) |
| 1~3 | 클라우드 저장 켜기 | Supabase 무료 계정 |
| 4 | 카카오 앱 만들기 | 카카오 디벨로퍼스 계정 |
| 5~6 | 카톡 알림 서버 올리기 + 매일 9시 예약 | PC에 Node.js |
| 7 | 휴대폰에서 로그인 · 카카오 연결 · 설치 | 휴대폰 |

---

## 0. 앱 주소 만들기 (GitHub Pages)
이 저장소는 GitHub Pages가 켜져 있습니다. 이 작업 브랜치를 **기본 브랜치에 합치면(merge)** 아래 주소로 열립니다.

```
https://l9h7j989-spec.github.io/-/plumbing/
```
- 안 열리면: 저장소 **Settings → Pages** 에서 Source 가 기본 브랜치 / root 로 되어 있는지 확인.
- 아래 모든 단계에서 **APP_URL = 위 주소(끝의 / 포함)** 입니다.

## 1. Supabase 프로젝트 만들기
1. https://supabase.com 가입 → **New project**
2. 이름: `plumbing` / 지역(Region): **Northeast Asia (Seoul)** / DB 비밀번호는 아무거나 길게(따로 적어두기)
3. 만들어지면 프로젝트 주소의 `https://<PROJECT_REF>.supabase.co` 에서 **PROJECT_REF**(영문 20자 정도)를 적어둡니다.

## 2. DB 만들기
1. 왼쪽 메뉴 **SQL Editor → New query**
2. 이 폴더의 `supabase/schema.sql` 내용을 통째로 붙여넣고 **Run**. "Success" 가 나오면 끝.

## 3. 로그인 설정 + 앱에 연결
1. **Authentication → Sign In / Providers → Email**: 켜져 있는지 확인.
   혼자 쓰는 앱이면 **Confirm email 을 끄면** 가입 즉시 로그인됩니다(켜두면 메일 확인 링크를 눌러야 함).
2. **Authentication → URL Configuration → Site URL** 에 APP_URL 입력.
3. **Project Settings → API Keys** 에서 **anon (또는 publishable) 키** 복사. ⚠️ `service_role` / `secret` 키는 절대 앱에 넣지 마세요.
4. 둘 중 하나:
   - (권장) 저장소의 `plumbing/config.js` 에 `supabaseUrl`, `supabaseAnonKey` 를 채워 올리기 → 모든 폰에 자동 적용
   - 또는 휴대폰 앱 **설정 → 클라우드 저장** 화면에 직접 입력

여기까지 하면 **클라우드 저장은 완료**입니다. (카톡 알림이 필요 없으면 7단계로)

## 4. 카카오 앱 만들기 (카톡 알림용)
카카오 화면 메뉴 이름은 2025년 개편 이후 조금씩 바뀌고 있어 아래와 다를 수 있습니다.
1. https://developers.kakao.com 로그인 → **내 애플리케이션 → 애플리케이션 추가** (이름: 업무수첩)
2. **카카오 로그인 → 사용 설정 ON**
3. **카카오 로그인 → 동의항목 → "카카오톡 메시지 전송(talk_message)"** 을 **선택 동의**로 설정
4. **앱 → 플랫폼 키 → REST API 키** 화면에서
   - **REST API 키** 복사 (= KAKAO_REST_KEY)
   - **Redirect URI** 에 APP_URL 그대로 등록 (예: `https://l9h7j989-spec.github.io/-/plumbing/`, 끝의 `/` 까지 정확히)
   - **클라이언트 시크릿**이 켜져 있으면 그 값 복사 (= KAKAO_CLIENT_SECRET). 꺼져 있으면 비워둠
5. **웹 도메인(제품 링크 관리 / 플랫폼 → Web)** 에 `https://l9h7j989-spec.github.io` 등록 (카톡 메시지의 [앱 열기] 버튼용)
6. `plumbing/config.js` 의 `kakaoRestKey` 에 REST API 키 입력 (또는 앱에서 연결 누를 때 입력)

## 5. 카톡 알림 서버 함수 올리기 (PC에서)
PC에 Node.js 가 있어야 합니다(https://nodejs.org LTS 설치). 저장소를 내려받은 뒤 **`plumbing` 폴더에서** 명령창을 열고 한 줄씩 실행:

```bash
npx supabase login
```
```bash
npx supabase link --project-ref <PROJECT_REF>
```
```bash
npx supabase functions deploy kakao-auth --no-verify-jwt
```
```bash
npx supabase functions deploy kakao-notify --no-verify-jwt
```
비밀값 넣기 (`<...>` 를 바꿔서. CRON_SECRET 은 아무 긴 영문·숫자 30자 이상 직접 만들기):
```bash
npx supabase secrets set KAKAO_REST_KEY=<REST API 키> KAKAO_CLIENT_SECRET=<시크릿, 없으면 이 항목 빼기> CRON_SECRET=<직접 만든 긴 문자열> APP_URL=https://l9h7j989-spec.github.io/-/plumbing/
```

## 6. 매일 오전 9시 예약
1. Supabase **SQL Editor** 에 `supabase/schedule.sql` 붙여넣기
2. `<PROJECT_REF>` 와 `<CRON_SECRET>`(5단계와 같은 값) 두 곳을 바꾸고 **Run**
3. 시간을 바꾸려면 `'0 0 * * *'` 수정 (UTC 기준이라 한국시간 −9시간. 예: 오전 8시 = `'0 23 * * *'`)

## 7. 휴대폰에서
1. APP_URL 접속 → 아래 **⚙️설정**
2. **☁️ 클라우드 저장** → 이메일·비밀번호로 **처음이면 가입** (다른 폰에서는 로그인)
   - 그동안 폰에만 있던 기록은 첫 로그인 때 자동으로 올라갑니다.
3. **💬 미수금 카톡 알림** → **카카오 연결** → 카카오 동의 → **지금 테스트 발송** → 카톡 "나와의 채팅" 확인
4. **📱 앱으로 설치** → 안드로이드는 [홈 화면에 앱 설치], 아이폰은 Safari 공유버튼 → 홈 화면에 추가

---

## 꼭 알아둘 점
- **Supabase 무료 플랜은 7일 동안 사용이 거의 없으면 프로젝트가 일시정지**됩니다. 앱을 매일 쓰면 문제없지만, 1주 이상 안 쓰면 알림도 멈출 수 있습니다(예약 작업만으로 '사용'으로 인정되는지는 공식 문서에 없음). 정지되면 Supabase 대시보드에서 **Restore** 를 누르면 됩니다. 확실히 막으려면 유료(Pro) 플랜.
- **카카오 연결은 약 2개월마다 다시 해야 할 수 있습니다.** (리프레시 토큰 유효기간 2개월. 앱이 자동 연장을 시도하지만 연장 안 되면 설정 화면에 '재연결 필요일'이 보입니다)
- 무료 한도: DB 500MB, 파일(사진) 1GB. 사진은 앱이 1600px로 줄여 장당 약 0.3~0.5MB → 약 2,000~3,000장.
- 카톡 한 통은 200자 제한이라, 미수가 많으면 여러 통으로 나눠 보냅니다(최대 5통).

## 문제 해결
| 증상 | 확인 |
|---|---|
| 상단 ⚠️ 동기화 오류 | 2단계 schema.sql 실행했는지, 키가 anon/publishable 인지 |
| 카카오 연결 실패 KOE006 | Redirect URI 가 APP_URL 과 글자 하나까지 같은지 |
| 카카오 연결 실패 (client_secret) | 시크릿이 켜져 있으면 5단계 KAKAO_CLIENT_SECRET 필요 |
| 테스트 발송 -402 | 동의항목 talk_message 설정 후 **카카오 다시 연결** |
| 5단계에서 config.toml 이 없다는 오류 | `plumbing` 폴더에서 `npx supabase init` 한 번 실행 후 다시 (질문에는 모두 N) |
| 매일 알림이 안 옴 | SQL Editor 에서 `select * from cron.job_run_details order by start_time desc limit 5;` 실행해 오류 확인 |
