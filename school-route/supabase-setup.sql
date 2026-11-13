-- 미미 프레쉬 앱 저장용 표. Supabase → SQL Editor 에 통째로 붙여넣고 Run 을 한 번 누르면 됩니다.
-- 여러 번 실행해도 안전합니다.

create table if not exists public.mimifresh (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- 거래처·방문 기록·견적·설정
  template   text,                                 -- 견적서 양식 파일
  updated_at timestamptz not null default now()
);

alter table public.mimifresh enable row level security;

-- 로그인한 본인의 줄만 보고, 만들고, 고칠 수 있습니다.
drop policy if exists "mimifresh own select" on public.mimifresh;
drop policy if exists "mimifresh own insert" on public.mimifresh;
drop policy if exists "mimifresh own update" on public.mimifresh;
create policy "mimifresh own select" on public.mimifresh for select to authenticated using ((select auth.uid()) = user_id);
create policy "mimifresh own insert" on public.mimifresh for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "mimifresh own update" on public.mimifresh for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.mimifresh to authenticated;
