-- Adds the "Show ranking on the live results page" setting.
-- Run once in the Supabase SQL editor. Safe to run again.
alter table public.activities
  add column if not exists show_rank boolean not null default true;
