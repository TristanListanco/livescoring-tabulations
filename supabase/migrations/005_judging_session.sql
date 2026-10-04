-- Judging sessions: the organizer starts and ends judging, and picks the entry judges score next.
-- Run in the Supabase SQL editor after 004. Safe to run again.
-- Additive only: the version of the app already deployed ignores these columns. The rule that judges
-- may only score the current entry of a live session is enforced by the app, not a trigger, so running
-- this before deploying the new version doesn't block scoring on the old one.

-- draft: not started, judges see a waiting screen. live: judging is open. ended: judging is closed.
alter table if exists public.activities
  add column if not exists session_state text not null default 'draft';
alter table if exists public.activities
  add column if not exists session_started_at timestamptz;
-- The entry every judge is scoring right now; null while the organizer hasn't picked one.
alter table if exists public.activities
  add column if not exists current_entry_id uuid references public.entries (id) on delete set null;

do $$
begin
  if to_regclass('public.activities') is not null
     and not exists (select 1 from pg_constraint where conname = 'activities_session_state_check') then
    alter table public.activities
      add constraint activities_session_state_check check (session_state in ('draft', 'live', 'ended'));
  end if;
end;
$$;
