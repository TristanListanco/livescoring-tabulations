-- Judge device approval, criteria-based scoring, and report signatories.
-- Run in the Supabase SQL editor after 005. Safe to run again.
-- Additive only: the version of the app already deployed ignores these tables and columns.

-- Judge devices ---------------------------------------------------------------
-- Every device that signs in with a judge's code asks for approval; the organizer approves one per
-- judge. No row level security policies: only the server reads them.
do $$
begin
  if to_regclass('public.judges') is not null then
    create table if not exists public.judge_devices (
      id            uuid primary key default gen_random_uuid(),
      judge_id      uuid not null references public.judges (id) on delete cascade,
      pairing_code  text not null,
      label         text not null,
      status        text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
      created_at    timestamptz not null default now(),
      decided_at    timestamptz
    );
    create index if not exists judge_devices_judge_idx on public.judge_devices (judge_id);
    alter table public.judge_devices enable row level security;
  end if;
end;
$$;

-- Bumped whenever a judge's devices change, so open screens refresh over realtime without the
-- devices themselves ever being readable by the public.
alter table if exists public.judges add column if not exists devices_updated_at timestamptz;

-- Criteria-based scoring -----------------------------------------------------------
-- simple: one score per judge between min and max. criteria: judges score each criterion; the
-- criteria's max points add up to 100 and the stored score is the total.
alter table if exists public.activities add column if not exists scoring_mode text not null default 'simple';
alter table if exists public.activities add column if not exists criteria jsonb not null default '[]'::jsonb;
-- How totals out of 100 are shown: as a percentage, or scaled to 10.
alter table if exists public.activities add column if not exists criteria_display text not null default 'percent';
-- Each judge's points per criterion, keyed by criterion id.
alter table if exists public.scores add column if not exists breakdown jsonb;

-- Report signatories -----------------------------------------------------------------
-- Names and designations (e.g. Board of Tabulators) printed as signature lines on the PDF.
alter table if exists public.admins add column if not exists signatories jsonb not null default '[]'::jsonb;
