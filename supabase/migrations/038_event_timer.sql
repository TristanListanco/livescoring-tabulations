-- A scoring timer for events.
--
-- activities.timer_seconds: an event judged an entry at a time (simple or criteria scoring) can give judges a set time to score
-- each entry, as a pageant's sub-activities can (rounds.timer_seconds): showing an entry starts it (scoring_closes_at),
-- and once it runs out the server refuses scores until the organizer gives more time from the desk. Null: no timer. Set
-- on the create form, changeable until the session starts.
--
-- Run in the Supabase SQL editor after 037, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, events have no timer. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists timer_seconds integer;
  if not exists (select 1 from pg_constraint where conname = 'activities_timer_seconds_range') then
    alter table public.activities add constraint activities_timer_seconds_range check (timer_seconds is null or timer_seconds between 5 and 3600);
  end if;
end;
$migration$;
