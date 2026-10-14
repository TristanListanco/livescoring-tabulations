-- Limits on guessing: failed sign-ins (admin passwords, judge codes) are counted per network address and per
-- account, and too many in a short time are refused for a while. Server only, like judge_access.
-- Run in the Supabase SQL editor after 016. Safe to run again.
-- Additive only: the version of the app already deployed ignores the new table. Until it's run, the new version
-- signs people in without the limit (it never locks anyone out because the table is missing).
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;
  create table if not exists public.sign_in_failures (
    id          bigint generated always as identity primary key,
    -- What failed: "admin-ip:<address>", "admin:<email or super>" or "judge-ip:<address>".
    key         text not null check (char_length(key) between 1 and 300),
    created_at  timestamptz not null default now()
  );
  create index if not exists sign_in_failures_key_idx on public.sign_in_failures (key, created_at);
  alter table public.sign_in_failures enable row level security;
end;
$migration$;
