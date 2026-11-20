-- 006: 업무 댓글·@멘션, 마일스톤

-- 1) 마일스톤 (행사일·런칭일 같은 하루짜리 기준일) -----------------------------
alter table public.items add column if not exists is_milestone boolean not null default false;

-- 2) 댓글 ------------------------------------------------------------------
create table if not exists public.item_comments (
  id          bigint generated always as identity primary key,
  item_id     text not null references public.items(id) on delete cascade,
  author      text not null,
  body        text not null check (char_length(body) between 1 and 2000),
  mentions    text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists item_comments_item on public.item_comments(item_id, created_at);
create index if not exists item_comments_time on public.item_comments(created_at desc);
alter table public.item_comments enable row level security;
drop policy if exists cmt_read   on public.item_comments;
drop policy if exists cmt_insert on public.item_comments;
drop policy if exists cmt_delete on public.item_comments;
-- 승인된 사람은 모두 읽기, 팀원·관리자는 어느 업무에나 댓글 가능(작성자는 본인 이름으로만), 삭제는 본인 또는 관리자
create policy cmt_read   on public.item_comments for select to authenticated using (public.member_role() is not null);
create policy cmt_insert on public.item_comments for insert to authenticated
  with check (public.member_role() in ('admin','member') and author = public.my_name());
create policy cmt_delete on public.item_comments for delete to authenticated
  using (author = public.my_name() or public.member_role() = 'admin');

-- 3) 실시간: 새 댓글·멘션 알림 -------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.item_comments;
exception when duplicate_object then null; end $$;
