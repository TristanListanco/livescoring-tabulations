-- When a judging session ended, and archived activities. The live results say "Ended" with the date and time. Once
-- its session has ended, an activity can be archived: from then on it can't be reopened, reset or un-archived, only
-- read (its results and score sheets still download) and deleted.
-- Run in the Supabase SQL editor after 019. Safe to run again.
-- Additive: the version of the app already deployed ignores the new columns. Until it's run, the new version shows
-- "Ended" without a time and doesn't offer archiving.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists session_ended_at timestamptz;
  alter table public.activities add column if not exists archived_at timestamptz;

  -- Only an ended session can be archived, and an archived one stays ended: it can't be reopened or reset.
  if not exists (select 1 from pg_constraint where conname = 'activities_archived_ended_check') then
    alter table public.activities
      add constraint activities_archived_ended_check check (archived_at is null or session_state = 'ended');
  end if;

  -- Archiving is for good.
  create or replace function public.forbid_unarchive() returns trigger
  language plpgsql
  as $fn$
  begin
    if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
      raise exception 'An archived activity stays archived.';
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists forbid_unarchive on public.activities;
  create trigger forbid_unarchive before update on public.activities for each row execute function public.forbid_unarchive();
end;
$migration$;
