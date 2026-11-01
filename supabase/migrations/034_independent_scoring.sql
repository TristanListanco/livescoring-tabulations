-- Judges score at their own pace.
--
-- activities.independent_scoring: in an event without live scoring, each judge scores the entries in any order, without
-- waiting for the organizer or the chair to show the next one; the chair still starts the deliberation once every judge
-- has scored every entry. Off unless the organizer turns it on, until the session starts.
--
-- Run in the Supabase SQL editor after 033, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, every event is judged an entry at a time, as before. On a brand-new database this does nothing, and schema.sql
-- creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists independent_scoring boolean not null default false;
end;
$migration$;
