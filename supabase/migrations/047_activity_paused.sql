-- A pageant paused in the break between its preliminary and pageant proper.
--
-- activities.paused_at: set when the organizer pauses the pageant after the preliminary (with their password), so they
-- can sign out until pageant proper; every judge's device is signed out with it. Cleared when they resume it (with their
-- password again). Only ever set in the break: the server moves it, with conditional writes, as the segments' other
-- moves are (see docs/state-machines.md).
--
-- Run in the Supabase SQL editor after 046, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, a pageant can't be paused. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  alter table public.activities add column if not exists paused_at timestamptz;
end;
$migration$;
