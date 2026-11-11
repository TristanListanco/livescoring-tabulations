-- The panel of judges locked in the database too.
--
-- check_judges_locked: judges can't be added or removed once the session has started, or after it did and the scores
-- were reset (session_started_at stays set). The server says so first (judgesLocked in src/lib/judging.ts); this holds
-- it for anything that slips past, such as a judge added in the instant the session starts. Deleting the activity
-- itself still takes its judges with it.
--
-- Run in the Supabase SQL editor after 038, or let the release pipeline run it. Safe to run again. On a brand-new
-- database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  create or replace function public.check_judges_locked()
  returns trigger
  language plpgsql
  as $fn$
  declare
    a public.activities%rowtype;
  begin
    -- The activity being deleted takes its judges with it.
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;
    select * into a from public.activities where id = coalesce(new.activity_id, old.activity_id);
    if found and (a.session_state <> 'draft' or a.session_started_at is not null) then
      raise exception 'The session has started, so the panel of judges is locked.' using errcode = '55000';
    end if;
    return coalesce(new, old);
  end;
  $fn$;
  drop trigger if exists judges_locked on public.judges;
  create trigger judges_locked
    before insert or delete on public.judges
    for each row execute function public.check_judges_locked();
end;
$migration$;
