-- A pageant sub-activity's criteria totals shown out of 10 on the LED wall alone.
--
-- rounds.led_out_of_ten: a sub-activity scored live, by criteria whose totals are shown as percentages, can put them on
-- the LED wall scaled to 10 (87.5% shows as 8.75). The live results, the tally, the PDFs and every ranking keep the
-- percentages. Its parts follow it.
--
-- Run in the Supabase SQL editor after 041, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the wall shows the percentages. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.rounds') is null then
    return;
  end if;
  alter table public.rounds add column if not exists led_out_of_ten boolean not null default false;
end;
$migration$;
