-- Where an activity happens, when the organizer gives it.
--
-- activities.location: an optional line, such as "Bldg 2, Room 204, 3rd floor", for telling breakout rooms apart. The
-- organizer sees it under the activity's name and in the list of activities; judges see it beside the activity's name on
-- their screens, and it prints on the results PDFs. Null when not given.
--
-- Run in the Supabase SQL editor after 034, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, activities have no location and the form doesn't save one. On a brand-new database this does nothing, and
-- schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists location text;
  if not exists (select 1 from pg_constraint where conname = 'activities_location_length') then
    alter table public.activities add constraint activities_location_length check (location is null or char_length(location) between 1 and 120);
  end if;
end;
$migration$;
