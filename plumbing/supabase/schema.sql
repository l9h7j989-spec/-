-- ============================================================
-- 배관 업무수첩 클라우드 DB (Supabase SQL Editor 에 통째로 붙여넣고 Run)
-- 여러 번 실행해도 안전하게 작성됨
-- ============================================================

-- 1) 기록 저장 테이블 (작업 / 할일 / 견적 / 설정)
create table if not exists public.records (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text        not null check (kind in ('jobs','todos','estimates','settings')),
  id             text        not null,
  data           jsonb,
  deleted        boolean     not null default false,
  client_updated bigint      not null default 0,   -- 기기에서 고친 시각(ms). 나중 것이 이긴다
  updated_at     timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);

-- 서버 시각 기록 + 더 오래된 수정이 새 수정을 덮어쓰지 않게 막기
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_updated < old.client_updated then
    return null;               -- 오래된 값은 무시
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2) 사진·양식 파일 저장소 (비공개). 경로: <사용자ID>/파일
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own files select" on storage.objects;
drop policy if exists "own files insert" on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;
create policy "own files select" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files update" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3) 카카오 토큰 (서버 함수만 읽고 쓴다. 앱에서는 직접 못 읽음)
create table if not exists public.kakao_tokens (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  access_token       text not null,
  refresh_token      text not null,
  access_expires_at  timestamptz,
  refresh_expires_at timestamptz,
  last_sent_at       timestamptz,
  last_result        text,
  updated_at         timestamptz not null default now()
);
alter table public.kakao_tokens enable row level security;  -- 정책 없음 = 앱에서 접근 불가

-- 앱에서 '연결 상태'만 볼 수 있는 함수 (토큰 값은 안 보여줌)
create or replace function public.kakao_status()
returns table (connected boolean, refresh_expires_at timestamptz, last_sent_at timestamptz, last_result text)
language sql security definer set search_path = public stable as $$
  select true, k.refresh_expires_at, k.last_sent_at, k.last_result
  from public.kakao_tokens k where k.user_id = auth.uid()
  union all
  select false, null, null, null
  where not exists (select 1 from public.kakao_tokens where user_id = auth.uid())
$$;
revoke all on function public.kakao_status() from public, anon;
grant execute on function public.kakao_status() to authenticated;

-- 카카오 연결 끊기
create or replace function public.kakao_disconnect()
returns void language sql security definer set search_path = public as $$
  delete from public.kakao_tokens where user_id = auth.uid()
$$;
revoke all on function public.kakao_disconnect() from public, anon;
grant execute on function public.kakao_disconnect() to authenticated;
