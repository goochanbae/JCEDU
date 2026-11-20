-- 005: 직원용 '내 업무' — 팀원 수정 범위 제한, 등록자, 최근 메모, 체크리스트, 미분류함

-- 1) 컬럼: 등록자, 최근 업데이트 메모 -------------------------------------------
alter table public.items add column if not exists created_by text;
alter table public.items add column if not exists memo text;

-- 2) 로그인한 사람의 담당자 이름 (members.name = staff.name) ---------------------
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select name from public.members where lower(email) = lower(auth.jwt() ->> 'email')
$$;

-- 3) 팀원 수정 범위: 내 업무(PIC·Backup·등록자, '전원' 업무)만 내용 수정 가능 -------
--    남의 업무는 번호·순서·계층(num, sort_order, lvl, parent)만 바뀔 수 있음
--    (내 업무를 옮기거나 하위 업무를 추가할 때 화면이 자동으로 맞추는 값)
create or replace function public.can_edit_item(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.member_role() = 'admin'
      or (public.member_role() = 'member' and exists (
            select 1 from public.items i where i.id = p_id
              and (i.pic = public.my_name() or i.bak = public.my_name()
                   or i.created_by = public.my_name() or i.pic = '전원')))
$$;

create or replace function public.items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r text := public.member_role();
  n text := public.my_name();
  keep text[] := array['num','sort_order','lvl','parent','updated_at','updated_by'];
begin
  if tg_op = 'INSERT' then
    if r is not null then new.created_by := n; end if;   -- 등록자는 로그인한 사람으로 고정
    return new;
  end if;
  if r is null or r = 'admin' then return new; end if;   -- 대시보드(SQL)·관리자
  if old.pic = n or old.bak = n or old.created_by = n or old.pic = '전원' then
    new.created_by := old.created_by;                    -- 등록자는 바꿀 수 없음
    return new;
  end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception '담당자(PIC·Backup)나 등록한 사람만 수정할 수 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists items_guard on public.items;
create trigger items_guard before insert or update on public.items
  for each row execute function public.items_guard();

-- 4) 체크리스트 (있으면 진척률 = 체크한 비율) -------------------------------------
create table if not exists public.item_checks (
  id          bigint generated always as identity primary key,
  item_id     text not null references public.items(id) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists item_checks_item on public.item_checks(item_id, sort_order);
alter table public.item_checks enable row level security;
drop policy if exists checks_read  on public.item_checks;
drop policy if exists checks_write on public.item_checks;
create policy checks_read  on public.item_checks for select to authenticated using (public.member_role() is not null);
create policy checks_write on public.item_checks for all to authenticated
  using (public.can_edit_item(item_id)) with check (public.can_edit_item(item_id));

-- 5) 미분류함: 위치를 정하지 않고 등록한 업무가 모이는 카테고리 (관리자가 WBS 위치로 정리)
insert into public.items (id, sheet, num, lvl, parent, cat, w, sort_order, updated_by)
select s.id, s.sheet, '0', 'L1', null, '미분류함', 0,
       coalesce((select min(sort_order) from public.items where sheet = s.sheet), 1) - 1, '시스템'
from (values ('WBS-INBOX','WBS'), ('REQ-INBOX','REQ')) as s(id, sheet)
on conflict (id) do nothing;
