-- Entry photos (shown on the LED wall) and how many decimal places results show.
-- Run in the Supabase SQL editor after 006. Safe to run again.
-- Additive only: the version of the app already deployed ignores these columns.

-- An optional photo per entry, stored in the judge-photos bucket under the activity's folder.
alter table if exists public.entries add column if not exists photo_path text;

-- Decimal places for averages and criteria totals on the live results, LED wall and PDF (0 to 4).
-- Judges still enter scores with the activity's own decimals (0 to 2).
alter table if exists public.activities add column if not exists result_decimals smallint not null default 2;
do $$
begin
  if to_regclass('public.activities') is not null
     and not exists (select 1 from pg_constraint where conname = 'activities_result_decimals_check') then
    alter table public.activities
      add constraint activities_result_decimals_check check (result_decimals between 0 and 4);
  end if;
end;
$$;
