-- The rule that a session with scores can't go back to not started. It was added to 021 after 021 had already been
-- run on the live project, so a database that ran 021 before then doesn't have it (the app refuses the change too;
-- this is the database holding to it as well). Migrations are no longer changed once merged (see the README).
--
-- Run in the Supabase SQL editor after 023, or let the release pipeline run it. Safe to run again: on a database that
-- already has the rule (one created from schema.sql, or that ran the later 021), it changes nothing.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  -- A session goes back to not started only once its scores are gone (Reset scores, on a test site, deletes them
  -- first). Otherwise reopening its judges, running order and program would let the results be changed after scoring.
  create or replace function public.check_session_restart() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.session_state = 'draft' and old.session_state is distinct from 'draft'
       and exists (select 1 from public.scores s where s.activity_id = new.id) then
      raise exception 'A session with scores can''t go back to not started.';
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists check_session_restart on public.activities;
  create trigger check_session_restart before update on public.activities for each row execute function public.check_session_restart();
end;
$migration$;
