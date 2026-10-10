-- Separate review pointer preserves legacy agent_tasks readbacks during rollout.
alter table public.call_sessions add column if not exists review_alo_task_id uuid references public.alo_tasks(id) on delete set null;
alter table public.call_sessions add column if not exists review_alo_revision integer;
create index if not exists call_sessions_alo_review on public.call_sessions(review_alo_task_id) where review_alo_task_id is not null;
