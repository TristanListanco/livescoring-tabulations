-- The LED wall's look: a font, a colour theme and how rounded its panels are, chosen on the LED wall tab.
-- Run in the Supabase SQL editor after 013. Safe to run again.
-- Additive only: the version of the app already deployed ignores the new columns, and every activity keeps the
-- wall's original look (the standard font, navy, square corners) until someone changes it.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates them.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  alter table public.activities add column if not exists led_font text not null default 'default';
  alter table public.activities add column if not exists led_theme text not null default 'navy';
  alter table public.activities add column if not exists led_shape text not null default 'square';
  if not exists (select 1 from pg_constraint where conname = 'activities_led_look_check') then
    alter table public.activities add constraint activities_led_look_check check (
      led_font in ('default', 'elegant', 'modern', 'condensed', 'classic')
      and led_theme in ('navy', 'gold', 'crimson', 'emerald', 'royal', 'pearl')
      and led_shape in ('square', 'soft', 'round')
    );
  end if;
end;
$migration$;
