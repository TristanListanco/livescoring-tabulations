-- LED wall animation: entries and scores fade in (default) or wipe in from the left.
-- Run in the Supabase SQL editor after 008. Safe to run again.
-- Additive only: the version of the app already deployed ignores this column.
alter table if exists public.activities add column if not exists led_transition text not null default 'fade';
do $$
begin
  if to_regclass('public.activities') is not null
     and not exists (select 1 from pg_constraint where conname = 'activities_led_transition_check') then
    alter table public.activities
      add constraint activities_led_transition_check check (led_transition in ('fade', 'wipe'));
  end if;
end;
$$;
