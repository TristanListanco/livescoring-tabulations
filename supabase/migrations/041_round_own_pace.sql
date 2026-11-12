-- Judges score a pageant sub-activity at their own pace.
--
-- rounds.independent_scoring: a sub-activity whose results come after a deliberation (live_scoring false) can let its
-- judges score its candidates in any order, none shown one at a time, as an event can (migration 034). It has no timer
-- (the server keeps timer_seconds null for it). Its parts follow it.
--
-- Run in the Supabase SQL editor after 040, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, sub-activities are judged a candidate at a time. On a brand-new database this does nothing, and schema.sql
-- creates it.

do $migration$
begin
  if to_regclass('public.rounds') is null then
    return;
  end if;
  alter table public.rounds add column if not exists independent_scoring boolean not null default false;
end;
$migration$;
