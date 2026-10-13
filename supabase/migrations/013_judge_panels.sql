-- Pageant boards of judges: a judge can judge both segments (the default), only the preliminary, or only pageant
-- proper, for pageants with separate boards for the preliminary and pageant proper. Each board has its own chair.
-- Run in the Supabase SQL editor after 012. Safe to run again.
-- The version of the app already deployed keeps working: it ignores the new column and still makes one chair.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.judges') is null then
    return;
  end if;
  alter table public.judges add column if not exists panel text not null default 'all';
  if not exists (select 1 from pg_constraint where conname = 'judges_panel_check') then
    alter table public.judges add constraint judges_panel_check check (panel in ('all', 'preliminary', 'proper'));
  end if;
  -- One chair per board instead of one per activity.
  drop index if exists public.judges_one_chair_idx;
  create unique index if not exists judges_one_chair_per_board_idx on public.judges (activity_id, panel) where is_chair;
end;
$migration$;
