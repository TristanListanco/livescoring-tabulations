-- LED wall: the admin picks which entry the LED wall output shows.
-- Also includes 002 (show ranks), so running this one file brings any database up to date.
-- Run in the Supabase SQL editor. Safe to run again.
-- "if exists": on a brand-new database (e.g. the CI stack) this is a no-op and schema.sql adds the columns.
alter table if exists public.activities
  add column if not exists show_rank boolean not null default true;

alter table if exists public.activities
  add column if not exists led_entry_id uuid references public.entries (id) on delete set null;
