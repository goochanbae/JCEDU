-- 002: 삭제 요청(승인 대기) 컬럼 추가
-- 팀원(member)은 삭제 대신 '삭제 요청'을 남기고, 관리자(admin)가 승인하면 실제로 삭제됩니다.
alter table public.items add column if not exists delete_requested_by text;
alter table public.items add column if not exists delete_requested_at timestamptz;
