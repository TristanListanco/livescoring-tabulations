-- Board of tabulators: judges the organizer allows to move to the previous or next entry from their own screen.
-- Run in the Supabase SQL editor after 007. Safe to run again.
-- Additive only: the version of the app already deployed ignores this column.
alter table if exists public.judges add column if not exists can_move_entries boolean not null default false;
