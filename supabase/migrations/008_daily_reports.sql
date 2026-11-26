-- 008: 일일보고 — 업무 유형(목표·P·R), 컨펌 대기 상태, 일일보고·항목 테이블

-- 1) 업무 유형: goal = 목표·R&R(지연·일일보고 대상 아님) / P = 프로젝트 / R = 반복(루틴) 업무
alter table public.items add column if not exists kind text;
do $$ begin
  alter table public.items add constraint items_kind_check check (kind in ('goal','P','R'));
exception when duplicate_object then null; end $$;
-- 기존 업무 분류: 단발 → P, 그 외(상시·월간·연간 등 R&R 성격) → 목표. 카테고리(L1)는 비움
update public.items set kind = case when coalesce(cyc,'단발') = '단발' then 'P' else 'goal' end
 where kind is null and lvl in ('P','T','C');

-- 2) 진행 상태에 '컨펌 대기'(Review) 추가
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%In Progress%' loop
    execute format('alter table public.items drop constraint %I', c);
  end loop;
  alter table public.items add constraint items_st_check check (st in ('In Progress','Planned','Review','On Hold','Completed','Canceled'));
end $$;

-- 3) 일일보고 (사람당 하루 1건)
create table if not exists public.daily_reports (
  id            bigint generated always as identity primary key,
  report_date   date not null,
  author        text not null,
  issues        jsonb not null default '[]',      -- [{issue, action}]
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (author, report_date)
);
-- 보고 항목: done = 전일 업무 결과, today = 금일 업무 내용, plan = 이번 주 계획(제출 시점 스냅샷)
create table if not exists public.daily_entries (
  id          bigint generated always as identity primary key,
  report_id   bigint not null references public.daily_reports(id) on delete cascade,
  section     text not null check (section in ('done','today','plan')),
  item_id     text references public.items(id) on delete set null,
  kind        text check (kind in ('P','R')),
  title       text not null,
  detail      text,
  prog        numeric check (prog between 0 and 1),
  due_date    date,
  status      text,
  note        text,                                -- 예: 컨펌 대기
  sort_order  int not null default 0
);
create index if not exists daily_entries_report on public.daily_entries(report_id, section, sort_order);
create index if not exists daily_entries_item on public.daily_entries(item_id);
create index if not exists daily_reports_date on public.daily_reports(report_date desc);

alter table public.daily_reports enable row level security;
alter table public.daily_entries enable row level security;
drop policy if exists dr_read  on public.daily_reports;
drop policy if exists dr_write on public.daily_reports;
drop policy if exists de_read  on public.daily_entries;
drop policy if exists de_write on public.daily_entries;
-- 승인된 사람은 모두 읽기, 작성·수정은 본인 보고(관리자는 전체)
create policy dr_read  on public.daily_reports for select to authenticated using (public.member_role() is not null);
create policy dr_write on public.daily_reports for all to authenticated
  using (public.member_role() = 'admin' or (public.member_role() = 'member' and author = public.my_name()))
  with check (public.member_role() = 'admin' or (public.member_role() = 'member' and author = public.my_name()));
create policy de_read  on public.daily_entries for select to authenticated using (public.member_role() is not null);
create policy de_write on public.daily_entries for all to authenticated
  using (exists (select 1 from public.daily_reports d where d.id = report_id
                 and (public.member_role() = 'admin' or (public.member_role() = 'member' and d.author = public.my_name()))))
  with check (exists (select 1 from public.daily_reports d where d.id = report_id
                 and (public.member_role() = 'admin' or (public.member_role() = 'member' and d.author = public.my_name()))));

-- 4) 실시간: 팀 일일보고 화면 갱신
do $$ begin
  alter publication supabase_realtime add table public.daily_reports;
exception when duplicate_object then null; end $$;
