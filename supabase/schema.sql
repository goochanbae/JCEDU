-- JC EDU 마케팅 WBS — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (최초 1회)

-- 1) 팀원·권한 ------------------------------------------------------------
create table if not exists public.members (
  email text primary key,
  name  text not null,
  role  text not null default 'member' check (role in ('admin','member','viewer'))
);

-- 2) 업무 ----------------------------------------------------------------
create table if not exists public.items (
  id          text primary key,             -- W-001, R-001, 카테고리는 WBS-G1 형식
  sheet       text not null check (sheet in ('WBS','REQ')),
  num         text not null,                -- 화면 번호 (1, 1.1, 1.1.1)
  lvl         text not null check (lvl in ('L1','P','T','C')),  -- 카테고리 / 상위 업무 / 업무 / 하위 업무
  parent      text references public.items(id) on delete restrict,
  cat         text,
  brand       text,
  task        text,
  output      text,
  link        text,
  cyc         text,
  pic         text,
  bak         text,
  st          text check (st in ('In Progress','Planned','On Hold','Completed','Canceled')),
  start_date  date,
  end_date    date,
  w           numeric default 0,             -- 상세 가중치 (단발 업무만)
  prog        numeric,                       -- 진척률 0~1
  note        text,
  kpi_target  numeric,                       -- 상시 업무 월 목표
  kpi_actual  numeric,
  kpi_month   text,
  kpi_memo    text,
  req_date    date,                          -- 대표님 REQ 보고 관리
  req_text    text,
  due_date    date,
  done_date   date,
  feedback    text,
  delete_requested_by text,                  -- 삭제 요청자 (관리자 승인 대기)
  delete_requested_at timestamptz,
  sort_order  double precision not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists items_sheet_sort on public.items(sheet, sort_order);
create index if not exists items_parent on public.items(parent);

-- 3) 변경 이력 ------------------------------------------------------------
create table if not exists public.item_history (
  id          bigint generated always as identity primary key,
  item_id     text not null,
  changed_at  timestamptz not null default now(),
  changed_by  text not null,
  changes     text not null
);
create index if not exists item_history_item on public.item_history(item_id, changed_at desc);

-- 4) 권한 함수 ------------------------------------------------------------
create or replace function public.member_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where lower(email) = lower(auth.jwt() ->> 'email')
$$;

-- 5) RLS: 등록된 팀원만 조회, admin·member 편집, admin만 삭제 -----------------
alter table public.members      enable row level security;
alter table public.items        enable row level security;
alter table public.item_history enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.member_role() is not null);

drop policy if exists items_read   on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_read   on public.items for select to authenticated using (public.member_role() is not null);
create policy items_insert on public.items for insert to authenticated with check (public.member_role() in ('admin','member'));
create policy items_update on public.items for update to authenticated using (public.member_role() in ('admin','member')) with check (public.member_role() in ('admin','member'));
create policy items_delete on public.items for delete to authenticated using (public.member_role() = 'admin');

drop policy if exists hist_read   on public.item_history;
drop policy if exists hist_insert on public.item_history;
create policy hist_read   on public.item_history for select to authenticated using (public.member_role() is not null);
create policy hist_insert on public.item_history for insert to authenticated with check (public.member_role() in ('admin','member'));

-- 6) 실시간 반영 (다른 팀원이 고친 내용이 바로 보이게) ------------------------
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;
