-- Judges' first and last names, and the chair of the board of judges.
-- Run in the Supabase SQL editor after 007. Safe to run again.
-- Additive only: the version of the app already deployed ignores these columns.

-- First and last name. judges.name stays the full name ("Maria Santos"), shown on the results PDF;
-- the LED wall shows the first name.
alter table if exists public.judges add column if not exists first_name text;
alter table if exists public.judges add column if not exists last_name text;

-- The chair of the board of judges can move to the previous or next entry from their own screen.
-- At most one chair per activity.
alter table if exists public.judges add column if not exists is_chair boolean not null default false;
do $$
begin
  if to_regclass('public.judges') is not null then
    create unique index if not exists judges_one_chair_idx on public.judges (activity_id) where is_chair;
  end if;
end;
$$;
