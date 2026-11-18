-- 004: 회원가입 → 관리자 승인 방식 (메일 링크 로그인 폐지)
-- 가입하면 auth.users에 계정이 생기고, 트리거가 signup_requests에 승인 요청을 남깁니다.
-- 관리자가 승인하면 members에 들어가 그때부터 데이터를 볼 수 있습니다 (승인 전에는 RLS로 아무것도 안 보임).

create table if not exists public.signup_requests (
  email        text primary key,
  name         text not null,
  user_id      uuid not null,
  requested_at timestamptz not null default now()
);
alter table public.signup_requests enable row level security;
drop policy if exists req_read   on public.signup_requests;
drop policy if exists req_delete on public.signup_requests;
-- 본인 요청은 본인이 확인(승인 대기 화면), 관리자는 전체 확인·처리
create policy req_read   on public.signup_requests for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.member_role() = 'admin');
create policy req_delete on public.signup_requests for delete to authenticated
  using (public.member_role() = 'admin');

-- 가입 시 승인 요청 자동 등록 (이미 회원인 이메일은 제외)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.members where lower(email) = lower(new.email)) then
    return new;
  end if;
  insert into public.signup_requests (email, name, user_id)
  values (lower(new.email),
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
          new.id)
  on conflict (email) do update set name = excluded.name, user_id = excluded.user_id, requested_at = now();
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 관리자: 가입 거절 · 계정 삭제 (로그인 계정까지 지워서 같은 이메일로 다시 가입할 수 있게 함)
-- 담당자(staff)와 업무 기록은 그대로 남고, 담당자의 로그인 연결만 끊깁니다.
create or replace function public.admin_remove_account(p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if public.member_role() is distinct from 'admin' then
    raise exception '관리자만 할 수 있습니다';
  end if;
  if lower(p_email) = lower(auth.jwt() ->> 'email') then
    raise exception '본인 계정은 삭제할 수 없습니다';
  end if;
  delete from public.signup_requests where lower(email) = lower(p_email);
  delete from public.members         where lower(email) = lower(p_email);
  update public.staff set email = null where lower(email) = lower(p_email);
  delete from auth.users             where lower(email) = lower(p_email);
end $$;
revoke all on function public.admin_remove_account(text) from public, anon;
grant execute on function public.admin_remove_account(text) to authenticated;
