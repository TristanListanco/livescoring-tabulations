-- Pageant mode: candidates go through preliminary and pageant proper sub-activities (rounds), each with its own
-- scoring and an optional scoring timer, and pageant proper narrows the field with cuts (Top 10, Top 5, Top 3).
-- Run in the Supabase SQL editor after 010. Safe to run again.
-- The version of the app already deployed keeps working: events are unchanged, and a judge still scores an
-- event's entry only once.

-- Activities ---------------------------------------------------------------------------
-- event (the default) or pageant.
alter table if exists public.activities add column if not exists kind text not null default 'event';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_kind_check') then
    alter table public.activities add constraint activities_kind_check check (kind in ('event', 'pageant'));
  end if;
end;
$$;
-- The preliminary segment's share of a pageant's overall score, in percent. Pageant proper gets the rest.
alter table if exists public.activities add column if not exists preliminary_weight numeric(5, 2) not null default 0;
-- When scoring closes for the candidate on screen, while the sub-activity's timer runs.
alter table if exists public.activities add column if not exists scoring_closes_at timestamptz;

-- Sub-activities -------------------------------------------------------------------------
create table if not exists public.rounds (
  id               uuid primary key default gen_random_uuid(),
  activity_id      uuid not null references public.activities (id) on delete cascade,
  segment          text not null check (segment in ('preliminary', 'proper')),
  name             text not null check (length(btrim(name)) > 0),
  position         integer not null default 0,
  -- Share of its segment, in percent; a segment's sub-activities add up to 100.
  weight           numeric(5, 2) not null check (weight > 0 and weight <= 100),
  scoring_mode     text not null default 'simple' check (scoring_mode in ('simple', 'criteria')),
  min_score        numeric(7, 2) not null,
  max_score        numeric(7, 2) not null,
  decimals         smallint not null default 0 check (decimals in (0, 1, 2)),
  criteria         jsonb not null default '[]'::jsonb,
  criteria_display text not null default 'percent',
  -- Seconds judges get to score each candidate once shown; null for no limit.
  timer_seconds    integer check (timer_seconds between 5 and 3600),
  -- After this sub-activity the top N go through. The basis lists what ranks them: 'preliminary' and/or round ids.
  cut_size         integer check (cut_size > 0),
  cut_basis        jsonb not null default '[]'::jsonb,
  -- Who went through, best first, once the organizer confirmed the cut.
  cut_entry_ids    jsonb,
  created_at       timestamptz not null default now(),
  check (min_score >= 0),
  check (max_score > min_score)
);
create index if not exists rounds_activity_idx on public.rounds (activity_id, position);
alter table public.rounds enable row level security;
drop policy if exists "Public read" on public.rounds;
create policy "Public read" on public.rounds for select to anon, authenticated using (true);

-- The sub-activity being judged now.
alter table if exists public.activities add column if not exists current_round_id uuid references public.rounds (id) on delete set null;

-- Scores -------------------------------------------------------------------------------
-- A pageant score belongs to a sub-activity, so a judge scores a candidate once per sub-activity.
alter table if exists public.scores add column if not exists round_id uuid references public.rounds (id) on delete cascade;
alter table if exists public.scores drop constraint if exists scores_entry_id_judge_id_key;
create unique index if not exists scores_one_per_entry_idx on public.scores (entry_id, judge_id) where round_id is null;
create unique index if not exists scores_one_per_round_idx on public.scores (round_id, entry_id, judge_id) where round_id is not null;

-- Every new score is checked against its sub-activity's range and decimal places, or the activity's for events.
create or replace function public.check_score()
returns trigger
language plpgsql
as $$
declare
  a public.activities%rowtype;
  r public.rounds%rowtype;
  lo numeric;
  hi numeric;
  places smallint;
begin
  select * into a from public.activities where id = new.activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;
  if not exists (select 1 from public.entries where id = new.entry_id and activity_id = new.activity_id) then
    raise exception 'Entry does not belong to this activity';
  end if;
  if not exists (select 1 from public.judges where id = new.judge_id and activity_id = new.activity_id) then
    raise exception 'Judge does not belong to this activity';
  end if;
  lo := a.min_score;
  hi := a.max_score;
  places := a.decimals;
  if new.round_id is not null then
    select * into r from public.rounds where id = new.round_id and activity_id = new.activity_id;
    if not found then
      raise exception 'Sub-activity does not belong to this activity';
    end if;
    lo := r.min_score;
    hi := r.max_score;
    places := r.decimals;
  end if;
  if new.value < lo or new.value > hi then
    raise exception 'Score % is outside % to %', new.value, lo, hi;
  end if;
  if new.value <> round(new.value, places) then
    raise exception 'Score % has more than % decimal places', new.value, places;
  end if;
  return new;
end;
$$;

-- Realtime: judges' screens and the desk follow cuts and changes to the sub-activities.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rounds'
  ) then
    alter publication supabase_realtime add table public.rounds;
  end if;
end;
$$;
