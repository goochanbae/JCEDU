-- 003: 담당자(staff) 목록을 DB로 관리 + 관리자가 화면에서 로그인 계정(members)을 관리
create table if not exists public.staff (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  email       text,                       -- 로그인 이메일 (members와 연결, 없으면 로그인 없이 담당자로만 사용)
  active      boolean not null default true,
  sort_order  int not null default 0
);
alter table public.staff enable row level security;
drop policy if exists staff_read  on public.staff;
drop policy if exists staff_admin on public.staff;
create policy staff_read  on public.staff for select to authenticated using (public.member_role() is not null);
create policy staff_admin on public.staff for all    to authenticated using (public.member_role() = 'admin') with check (public.member_role() = 'admin');

-- 관리자만 로그인 계정(members) 추가·수정·삭제
drop policy if exists members_admin on public.members;
create policy members_admin on public.members for all to authenticated using (public.member_role() = 'admin') with check (public.member_role() = 'admin');

-- 초기 담당자: 업무에 적힌 PIC·Backup 이름 ('전원' 제외)
insert into public.staff (name, sort_order)
select n, row_number() over (order by n) from (
  select distinct pic as n from public.items where pic is not null and pic <> '전원'
  union select distinct bak from public.items where bak is not null and bak <> '전원'
) t
on conflict (name) do nothing;
update public.staff s set email = m.email from public.members m where m.name = s.name and s.email is null;
