-- LED wall: keep judges anonymous, so the wall shows a "?" in place of each judge's name and photo.
-- Run in the Supabase SQL editor after 009. Safe to run again.
-- Additive only: the version of the app already deployed ignores this column.
alter table if exists public.activities add column if not exists led_anonymous boolean not null default false;
