-- Judges' access codes sealed at rest.
--
-- judge_access.code_lookup: a keyed hash of the code (HMAC-SHA256), unique, that a typed code is found by.
-- judge_access.code_sealed: the code encrypted (AES-256-GCM, bound to its judge), for the Judges tab and QR codes.
-- Both keys come from the app's DATA_KEY, which the database never sees. judge_access.code is no longer required: a
-- code is kept either in the clear there (from before DATA_KEY was set; sealed when it's next read) or sealed, never
-- neither.
--
-- Run in the Supabase SQL editor after 043, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, and until DATA_KEY is set, codes stay in the clear as before. On a brand-new database this does nothing, and
-- schema.sql creates it.

do $migration$
begin
  if to_regclass('public.judge_access') is null then
    return;
  end if;

  alter table public.judge_access add column if not exists code_lookup text;
  alter table public.judge_access add column if not exists code_sealed text;
  alter table public.judge_access alter column code drop not null;
  create unique index if not exists judge_access_code_lookup_idx on public.judge_access (code_lookup);
  if not exists (select 1 from pg_constraint where conname = 'judge_access_code_kept') then
    alter table public.judge_access add constraint judge_access_code_kept
      check (code is not null or (code_lookup is not null and code_sealed is not null));
  end if;
end;
$migration$;
