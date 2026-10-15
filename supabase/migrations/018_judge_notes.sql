-- Judges' notes: one note per judge per entry (a candidate's note carries through a pageant), written on the judge's
-- screen and read by that judge and the organizer. Server only, like judge_access.
-- Run in the Supabase SQL editor after 017. Safe to run again.
-- Additive only: the version of the app already deployed ignores the new table. Until it's run, the new version hides
-- notes on the judges' screens.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  create table if not exists public.judge_notes (
    judge_id     uuid not null references public.judges (id) on delete cascade,
    entry_id     uuid not null references public.entries (id) on delete cascade,
    activity_id  uuid not null references public.activities (id) on delete cascade,
    body         text not null check (char_length(body) between 1 and 2000),
    updated_at   timestamptz not null default now(),
    primary key (judge_id, entry_id)
  );
  create index if not exists judge_notes_activity_idx on public.judge_notes (activity_id);
  alter table public.judge_notes enable row level security;
end;
$migration$;
