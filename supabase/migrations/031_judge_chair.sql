-- The chair of the board of judges can change until the session starts.
--
-- The chair was chosen when the activity was created, for good. Now another judge can take over before judging
-- starts: set_judge_chair hands the chair over from the judge who held it to the new one in one step (two chairs of a
-- board can't stand even for a moment, and no board is left without one), and only while the session hasn't started.
-- A session starting meanwhile waits for it, then starts with the new chair. The new chair takes over from the chair of
-- the same segments: the board's in an event or a pageant with one board, or one of a pageant's separate boards.
--
-- Run in the Supabase SQL editor after 030, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the app hands the chair over itself. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.judges') is null then
    return;
  end if;

  create or replace function public.set_judge_chair(judge uuid) returns void
  language plpgsql
  as $fn$
  declare
    activity uuid;
    j public.judges%rowtype;
  begin
    select activity_id into activity from public.judges where id = judge;
    -- Holds the activity until the chair has changed: a session starting meanwhile waits, then starts with it.
    perform 1 from public.activities a where a.id = activity and a.session_state = 'draft' for share;
    if not found then
      raise exception 'The session has started, so the panel of judges is locked.' using errcode = '55000';
    end if;
    select * into j from public.judges where id = judge for update;
    if j.is_chair then
      return;
    end if;
    -- From the chair of the same segments, so each board still has exactly one.
    update public.judges set is_chair = false where activity_id = activity and panel = j.panel and is_chair;
    if not found then
      raise exception 'Only a judge on the same segments as a chair can take over as chair.';
    end if;
    update public.judges set is_chair = true where id = judge;
  end;
  $fn$;
  -- Only the server changes the chair.
  revoke execute on function public.set_judge_chair(uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.set_judge_chair(uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_judge_chair(uuid) to service_role;
  end if;
end;
$migration$;
