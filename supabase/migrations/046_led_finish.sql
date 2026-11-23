-- The LED wall's finish: metal and glass, or flat.
--
-- activities.led_finish: 'glass' (the default) draws the wall's panels as dark glass in polished metal rims, with metal
-- plates and photo rings, as a pageant broadcast's; 'flat' draws the same panels in plain colour. Chosen on the LED
-- wall tab.
--
-- Run in the Supabase SQL editor after 045, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the wall is metal and glass. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  alter table public.activities add column if not exists led_finish text not null default 'glass';
  alter table public.activities drop constraint if exists activities_led_finish_check;
  alter table public.activities add constraint activities_led_finish_check check (led_finish in ('glass', 'flat'));
end;
$migration$;
