-- Adds the "Show ranking on the live results page" setting.
-- Run once in the Supabase SQL editor. Safe to run again.
-- "if exists": on a brand-new database (e.g. the CI stack) this is a no-op and schema.sql adds the column.
alter table if exists public.activities
  add column if not exists show_rank boolean not null default true;
