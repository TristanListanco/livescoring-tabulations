-- A preliminary sub-activity in parts can be judged candidate by candidate.
--
-- rounds.candidate_order: on a sub-activity with parts (never on a part), judges' screens show it as a whole, and each
-- candidate is scored on every part before the next one is shown, each judge going through the parts on their own.
-- It has no timer (the server keeps timer_seconds null for it and its parts). Without it, its parts are judged one at
-- a time, each through every candidate, as before.
--
-- Run in the Supabase SQL editor after 044, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, sub-activities are judged part by part. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.rounds') is null then
    return;
  end if;
  alter table public.rounds add column if not exists candidate_order boolean not null default false;
end;
$migration$;
