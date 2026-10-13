-- Pageant deductions (points off a candidate's preliminary score for a violation, with its reason), and seven more
-- colour themes for the LED wall.
-- Run in the Supabase SQL editor after 014. Safe to run again.
-- Additive only: the version of the app already deployed ignores the new column and table, and keeps working.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates them.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  -- The violations an organizer can deduct points for during the preliminary; null when a pageant has no deductions.
  alter table public.activities add column if not exists violations jsonb;

  -- Deductions given. No row level security policies, so only the server reads them: the public results never list them.
  create table if not exists public.deductions (
    id          uuid primary key default gen_random_uuid(),
    activity_id uuid not null references public.activities (id) on delete cascade,
    entry_id    uuid not null references public.entries (id) on delete cascade,
    points      numeric(5, 2) not null check (points > 0 and points <= 100),
    reason      text not null check (char_length(reason) between 1 and 80),
    created_at  timestamptz not null default now()
  );
  create index if not exists deductions_activity_idx on public.deductions (activity_id, created_at);
  alter table public.deductions enable row level security;

  -- The LED wall's themes, with midnight teal, rose gold, sunset amber, berry, graphite, champagne and sky added.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'led_theme') then
    alter table public.activities drop constraint if exists activities_led_look_check;
    alter table public.activities add constraint activities_led_look_check check (
      led_font in ('default', 'elegant', 'modern', 'condensed', 'classic')
      and led_theme in ('navy', 'gold', 'crimson', 'emerald', 'royal', 'teal', 'rose', 'sunset', 'berry', 'graphite', 'pearl', 'champagne', 'sky')
      and led_shape in ('square', 'soft', 'round')
    );
  end if;
end;
$migration$;
