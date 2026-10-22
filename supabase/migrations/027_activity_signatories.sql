-- Signatories belong to each activity, not to the organizer's account: each event has its own Board of Tabulators and
-- whoever else signs its results. Every activity starts with the signatories its organizer had, so the results PDFs it
-- already prints keep the same signature lines; from then on they're changed on the activity's Settings tab.
-- admins.signatories stays, unused, for the version of the app already deployed.
--
-- Run in the Supabase SQL editor after 026, or let the release pipeline run it. Safe to run again: the organizer's
-- signatories are copied only when the column is first added. Additive: the version of the app already deployed keeps
-- printing the organizer's. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activities' and column_name = 'signatories'
  ) then
    alter table public.activities add column signatories jsonb not null default '[]'::jsonb;
    update public.activities a
      set signatories = o.signatories
      from public.admins o
      where o.id = a.owner_id and jsonb_typeof(o.signatories) = 'array' and jsonb_array_length(o.signatories) > 0;
  end if;
end;
$migration$;
