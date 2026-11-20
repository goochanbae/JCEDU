-- 007: 변경 이력을 실시간으로 받아 알림(모든 변경 사항)에 바로 표시
do $$ begin
  alter publication supabase_realtime add table public.item_history;
exception when duplicate_object then null; end $$;
