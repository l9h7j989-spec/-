-- ============================================================
-- 매일 아침 미수금 카톡 알림 예약 (schema.sql 실행 + 함수 배포 후 실행)
-- 아래 두 값을 바꿔서 실행:
--   <PROJECT_REF>  : Supabase 프로젝트 주소의 앞부분 (https://<PROJECT_REF>.supabase.co)
--   <CRON_SECRET>  : 함수 비밀값으로 넣은 CRON_SECRET 과 같은 아무 긴 문자열
-- 시간: '0 0 * * *' = 매일 UTC 0시 = 한국 오전 9시
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'plumbing_project_url')
where not exists (select 1 from vault.secrets where name = 'plumbing_project_url');
select vault.create_secret('<CRON_SECRET>', 'plumbing_cron_secret')
where not exists (select 1 from vault.secrets where name = 'plumbing_cron_secret');

select cron.unschedule('plumbing-unpaid-kakao')
where exists (select 1 from cron.job where jobname = 'plumbing-unpaid-kakao');

select cron.schedule(
  'plumbing-unpaid-kakao',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'plumbing_project_url') || '/functions/v1/kakao-notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plumbing_cron_secret')),
    body    := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- 확인: select * from cron.job;   실행 기록: select * from cron.job_run_details order by start_time desc limit 5;
