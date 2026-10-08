-- LiveScoring schema. Paste into the Supabase SQL editor and run once.
-- All writes go through the Next.js server with the secret key; the browser
-- only reads public tables (for realtime) with the publishable key.

create extension if not exists pgcrypto;

-- Organizer accounts -----------------------------------------------------------
-- Managed by the super admin (ADMIN_PASSWORD). No row level security policies, so only the
-- server's secret key can read them: emails and password hashes never reach a browser.

create table if not exists public.admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  name           text not null check (length(btrim(name)) > 0),
  photo_path     text,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Names and designations printed as signature lines on the results PDF.
alter table public.admins add column if not exists signatories jsonb not null default '[]'::jsonb;

-- Activities ---------------------------------------------------------------

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  public_id   text not null unique,
  min_score   numeric(7, 2) not null,
  max_score   numeric(7, 2) not null,
  decimals    smallint not null default 0 check (decimals in (0, 1, 2)),
  show_rank   boolean not null default true,
  created_at  timestamptz not null default now(),
  check (min_score >= 0),
  check (max_score > min_score)
);


-- Judges -------------------------------------------------------------------

create table if not exists public.judges (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  photo_path   text,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
-- First and last name; name stays the full name. The LED wall shows the first name, the PDF the full name.
alter table public.judges add column if not exists first_name text;
alter table public.judges add column if not exists last_name text;
-- The chair of the board of judges can move to the previous or next entry from their own screen. One per activity.
alter table public.judges add column if not exists is_chair boolean not null default false;
create unique index if not exists judges_one_chair_idx on public.judges (activity_id) where is_chair;
create index if not exists judges_activity_idx on public.judges (activity_id, position);

-- Bumped whenever a judge's devices change, so open screens refresh over realtime.
alter table public.judges add column if not exists devices_updated_at timestamptz;

-- Access codes live apart from judges so the public role can never read them.
create table if not exists public.judge_access (
  judge_id  uuid primary key references public.judges (id) on delete cascade,
  code      text not null unique
);

-- Every device that signs in with a judge's code waits for the organizer's approval; one per judge
-- is approved. Server only, like judge_access.
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

-- Entries ------------------------------------------------------------------

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists entries_activity_idx on public.entries (activity_id, position);
-- An optional photo per entry, shown on the LED wall.
alter table public.entries add column if not exists photo_path text;

-- Settings added after the first release (also in supabase/migrations/).
alter table public.activities add column if not exists show_rank boolean not null default true;
-- The entry currently on the LED wall output; null shows only the green screen.
alter table public.activities add column if not exists led_entry_id uuid references public.entries (id) on delete set null;
-- The organizer who owns the activity; null means only the super admin manages it.
alter table public.activities add column if not exists owner_id uuid references public.admins (id) on delete set null;
create index if not exists activities_owner_idx on public.activities (owner_id);
-- LED wall: full-screen scoresheet instead of the green overlay; hold scores until every judge has scored.
alter table public.activities add column if not exists led_fullscreen boolean not null default false;
alter table public.activities add column if not exists led_hold_scores boolean not null default false;
-- LED wall animation: fade (default) or wipe.
alter table public.activities add column if not exists led_transition text not null default 'fade';
-- LED wall: keep judges anonymous (a "?" in place of each judge's name and photo).
alter table public.activities add column if not exists led_anonymous boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_led_transition_check') then
    alter table public.activities
      add constraint activities_led_transition_check check (led_transition in ('fade', 'wipe'));
  end if;
end;
$$;
-- Scoring: simple (min to max) or criteria (max points adding up to 100; the score is the total).
alter table public.activities add column if not exists scoring_mode text not null default 'simple';
alter table public.activities add column if not exists criteria jsonb not null default '[]'::jsonb;
alter table public.activities add column if not exists criteria_display text not null default 'percent';
-- Decimal places for averages and criteria totals in results (0 to 4); judges still enter 0 to 2.
alter table public.activities add column if not exists result_decimals smallint not null default 2;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_result_decimals_check') then
    alter table public.activities
      add constraint activities_result_decimals_check check (result_decimals between 0 and 4);
  end if;
end;
$$;
-- Pageant mode: event (the default) or pageant; the preliminary segment's share of a pageant's overall score
-- (pageant proper gets the rest); and when scoring closes for the candidate on screen while a timer runs.
alter table public.activities add column if not exists kind text not null default 'event';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_kind_check') then
    alter table public.activities add constraint activities_kind_check check (kind in ('event', 'pageant'));
  end if;
end;
$$;
alter table public.activities add column if not exists preliminary_weight numeric(5, 2) not null default 0;
alter table public.activities add column if not exists scoring_closes_at timestamptz;
-- Judging session: draft (not started), live, or ended; and the entry judges are scoring now.
alter table public.activities add column if not exists session_state text not null default 'draft';
alter table public.activities add column if not exists session_started_at timestamptz;
alter table public.activities add column if not exists current_entry_id uuid references public.entries (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_session_state_check') then
    alter table public.activities
      add constraint activities_session_state_check check (session_state in ('draft', 'live', 'ended'));
  end if;
end;
$$;

-- Pageant sub-activities -----------------------------------------------------
-- A pageant's sub-activities (rounds), in the preliminary or pageant proper segment, each with its own scoring.

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
-- The sub-activity being judged now.
alter table public.activities add column if not exists current_round_id uuid references public.rounds (id) on delete set null;

-- Scores -------------------------------------------------------------------

create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  entry_id     uuid not null references public.entries (id) on delete cascade,
  judge_id     uuid not null references public.judges (id) on delete cascade,
  value        numeric(7, 2) not null,
  created_at   timestamptz not null default now()
);
-- Points per criterion, keyed by criterion id, for criteria-based activities.
alter table public.scores add column if not exists breakdown jsonb;
create index if not exists scores_activity_idx on public.scores (activity_id);
-- A pageant score belongs to a sub-activity. A judge scores an event's entry once, and a candidate once per sub-activity.
alter table public.scores add column if not exists round_id uuid references public.rounds (id) on delete cascade;
alter table public.scores drop constraint if exists scores_entry_id_judge_id_key;
create unique index if not exists scores_one_per_entry_idx on public.scores (entry_id, judge_id) where round_id is null;
create unique index if not exists scores_one_per_round_idx on public.scores (round_id, entry_id, judge_id) where round_id is not null;

-- Validate every new score against its sub-activity (pageants) or its activity (events), whoever inserts it.
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

drop trigger if exists scores_check on public.scores;
create trigger scores_check
  before insert on public.scores
  for each row execute function public.check_score();

-- Submitted scores are final. Deleting (developer reset) is still allowed.
create or replace function public.forbid_score_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Submitted scores cannot be changed';
end;
$$;

drop trigger if exists scores_final on public.scores;
create trigger scores_final
  before update on public.scores
  for each row execute function public.forbid_score_update();

-- Row level security ---------------------------------------------------------
-- Public read for the live board; no public writes. judge_access has no
-- policies at all, so only the secret key can touch it.

alter table public.admins       enable row level security;
alter table public.activities   enable row level security;
alter table public.judges       enable row level security;
alter table public.judge_access enable row level security;
alter table public.judge_devices enable row level security;
alter table public.entries      enable row level security;
alter table public.scores       enable row level security;
alter table public.rounds       enable row level security;

drop policy if exists "Public read" on public.activities;
create policy "Public read" on public.activities for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.judges;
create policy "Public read" on public.judges for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.entries;
create policy "Public read" on public.entries for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.scores;
create policy "Public read" on public.scores for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.rounds;
create policy "Public read" on public.rounds for select to anon, authenticated using (true);

-- Realtime -------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'judges', 'entries', 'scores', 'rounds'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Judge photos -----------------------------------------------------------------
-- A public bucket: anyone can view a photo by URL; only the server uploads.

insert into storage.buckets (id, name, public)
values ('judge-photos', 'judge-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('organizer-photos', 'organizer-photos', true)
on conflict (id) do nothing;
