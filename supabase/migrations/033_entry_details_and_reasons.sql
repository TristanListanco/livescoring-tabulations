-- Entry details, and correction reasons from a list.
--
-- - activities.entry_fields: up to three details an event keeps about each entry (a school, a division, a region), each
--   { id, name }. entries.details: an entry's values, by field id, so renaming or removing a field never moves another's
--   values. Only the organizer sees them, on the Entries tab and the results (PDF and CSV); never judges or the public.
-- - activities.correction_reasons: in an event without live scoring, a judge correcting their own score picks the
--   reason from a list (or types one under Other) instead of typing it. Off unless the organizer turns it on.
--
-- Run in the Supabase SQL editor after 032, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the app leaves entry details and the reason list out. On a brand-new database this does nothing, and schema.sql
-- creates it.

do $migration$
begin
  if to_regclass('public.entries') is null then
    return;
  end if;

  alter table public.activities add column if not exists entry_fields jsonb not null default '[]'::jsonb;
  alter table public.entries add column if not exists details jsonb not null default '{}'::jsonb;
  alter table public.activities add column if not exists correction_reasons boolean not null default false;
end;
$migration$;
