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
  decimals    smallint not null default 0 check (decimals in (0, 1, 2, 3)),
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
-- The chair of the board of judges can move to the previous or next entry from their own screen.
alter table public.judges add column if not exists is_chair boolean not null default false;
-- Pageants: which segments the judge judges. all (the default), or only the preliminary or pageant proper.
alter table public.judges add column if not exists panel text not null default 'all';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'judges_panel_check') then
    alter table public.judges add constraint judges_panel_check check (panel in ('all', 'preliminary', 'proper'));
  end if;
end;
$$;
-- One chair per board: an activity has one, and a pageant with separate boards one for each segment.
drop index if exists public.judges_one_chair_idx;
create unique index if not exists judges_one_chair_per_board_idx on public.judges (activity_id, panel) where is_chair;
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

-- Failed sign-ins (admin passwords, judge codes), counted per network address and per account so too many in a short
-- time are refused for a while. Server only, like judge_access.
create table if not exists public.sign_in_failures (
  id          bigint generated always as identity primary key,
  -- What failed: "admin-ip:<address>", "admin:<email or super>" or "judge-ip:<address>".
  key         text not null check (char_length(key) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index if not exists sign_in_failures_key_idx on public.sign_in_failures (key, created_at);

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
-- LED wall animation: no longer read (the wall always fades); kept so older deployments still work.
alter table public.activities add column if not exists led_transition text not null default 'fade';
-- LED wall: keep judges anonymous (a "?" in place of each judge's name and photo).
alter table public.activities add column if not exists led_anonymous boolean not null default false;
-- LED wall: its look. A font, a colour theme and how rounded its panels are (see src/lib/led-style.ts).
alter table public.activities add column if not exists led_font text not null default 'default';
alter table public.activities add column if not exists led_theme text not null default 'navy';
alter table public.activities add column if not exists led_shape text not null default 'square';
-- Recreated each run, so a database set up before a theme was added takes the new list.
alter table public.activities drop constraint if exists activities_led_look_check;
alter table public.activities add constraint activities_led_look_check check (
  led_font in ('default', 'elegant', 'modern', 'condensed', 'classic')
  and led_theme in ('navy', 'gold', 'crimson', 'emerald', 'royal', 'teal', 'rose', 'sunset', 'berry', 'graphite', 'pearl', 'champagne', 'sky')
  and led_shape in ('square', 'soft', 'round')
);
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
-- Decimal places for averages and criteria totals in results (0 to 4); judges enter 0 to 3.
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
-- Judging session: draft (not started), live, deliberation (an event without live scoring, once every entry is
-- scored) or ended; and the entry judges are scoring now.
alter table public.activities add column if not exists session_state text not null default 'draft';
alter table public.activities add column if not exists session_started_at timestamptz;
alter table public.activities add column if not exists current_entry_id uuid references public.entries (id) on delete set null;
-- Dropped and added again, so a database set up before deliberation (and three decimal places) takes the new lists.
alter table public.activities drop constraint if exists activities_session_state_check;
alter table public.activities
  add constraint activities_session_state_check check (session_state in ('draft', 'live', 'deliberation', 'ended'));
alter table public.activities drop constraint if exists activities_decimals_check;
alter table public.activities add constraint activities_decimals_check check (decimals in (0, 1, 2, 3));
-- Live scoring (the default): the audience sees scores as they come in, and a submitted score is final. Without it the
-- audience sees no scores until the judges have signed, a judge can ask to correct a score, and the judges deliberate
-- once every entry is scored. signed_off_at: when the session ended with every judge's signature.
alter table public.activities add column if not exists live_scoring boolean not null default true;
alter table public.activities add column if not exists signed_off_at timestamptz;
-- Only an event without live scoring deliberates, and its session ends from deliberation only once every judge has signed.
create or replace function public.check_deliberation() returns trigger
language plpgsql
as $$
begin
  if new.session_state = 'deliberation' and old.session_state is distinct from 'deliberation'
     and (new.live_scoring or new.kind <> 'event') then
    raise exception 'Only an event without live scoring has a deliberation.';
  end if;
  if old.session_state = 'deliberation' and new.session_state = 'ended' and exists (
    select 1 from public.judges j
    where j.activity_id = new.id and not exists (select 1 from public.judge_signatures s where s.judge_id = j.id)
  ) then
    raise exception 'Every judge signs before the session ends.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_deliberation on public.activities;
create trigger check_deliberation before update on public.activities for each row execute function public.check_deliberation();
-- A session goes back to not started only once its scores are gone (Reset scores, on a test site, deletes them first).
-- Otherwise reopening its judges, running order and program would let the results be changed after scoring.
create or replace function public.check_session_restart() returns trigger
language plpgsql
as $$
begin
  if new.session_state = 'draft' and old.session_state is distinct from 'draft'
     and exists (select 1 from public.scores s where s.activity_id = new.id) then
    raise exception 'A session with scores can''t go back to not started.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_session_restart on public.activities;
create trigger check_session_restart before update on public.activities for each row execute function public.check_session_restart();
-- When the session last ended (the live results show it), and when the activity was archived. Only an ended session
-- can be archived, it stays ended (no reopening, no reset), and archiving is for good.
alter table public.activities add column if not exists session_ended_at timestamptz;
alter table public.activities add column if not exists archived_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_archived_ended_check') then
    alter table public.activities
      add constraint activities_archived_ended_check check (archived_at is null or session_state = 'ended');
  end if;
end;
$$;
create or replace function public.forbid_unarchive() returns trigger
language plpgsql
as $$
begin
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'An archived activity stays archived.';
  end if;
  return new;
end;
$$;
drop trigger if exists forbid_unarchive on public.activities;
create trigger forbid_unarchive before update on public.activities for each row execute function public.forbid_unarchive();

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
-- A part of a sub-activity (e.g. the Q&A of a closed-door interview). The sub-activity is then only a container.
alter table public.rounds add column if not exists parent_id uuid references public.rounds (id) on delete cascade;
create index if not exists rounds_parent_idx on public.rounds (parent_id);
-- The sub-activity being judged now.
alter table public.activities add column if not exists current_round_id uuid references public.rounds (id) on delete set null;
-- The violations an organizer can deduct points for during the preliminary; null when a pageant has no deductions.
alter table public.activities add column if not exists violations jsonb;

-- Deductions -----------------------------------------------------------------
-- Points off a candidate's preliminary score for a violation, with its reason. No row level security policies, so
-- only the server reads them: the public results never list them.

create table if not exists public.deductions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  entry_id    uuid not null references public.entries (id) on delete cascade,
  points      numeric(5, 2) not null check (points > 0 and points <= 100),
  reason      text not null check (char_length(reason) between 1 and 80),
  created_at  timestamptz not null default now()
);
create index if not exists deductions_activity_idx on public.deductions (activity_id, created_at);

-- Drafts ---------------------------------------------------------------------
-- Activities still being set up, saved from the create form. No row level security policies, so only the server
-- reads them. owner_id null is the super admin's.

create table if not exists public.activity_drafts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.admins (id) on delete cascade,
  kind        text not null check (kind in ('event', 'pageant')),
  name        text not null default '',
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists activity_drafts_owner_idx on public.activity_drafts (owner_id, updated_at desc);

-- Scores -------------------------------------------------------------------

create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  entry_id     uuid not null references public.entries (id) on delete cascade,
  judge_id     uuid not null references public.judges (id) on delete cascade,
  value        numeric(8, 3) not null,
  created_at   timestamptz not null default now()
);
-- Points per criterion, keyed by criterion id, for criteria-based activities.
alter table public.scores add column if not exists breakdown jsonb;
create index if not exists scores_activity_idx on public.scores (activity_id);
-- Each judge's screen reads that judge's scores.
create index if not exists scores_judge_idx on public.scores (judge_id);
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

-- On update too: a corrected score still has to fit its rules.
drop trigger if exists scores_check on public.scores;
create trigger scores_check
  before insert or update on public.scores
  for each row execute function public.check_score();

-- Submitted scores are final. One changes only through a score correction every other judge agreed to (or the
-- organizer approved, for a judge alone on their panel), applied by settle_score_correction (see Score corrections).
-- Deleting (developer reset) is still allowed.
create or replace function public.forbid_score_update()
returns trigger
language plpgsql
as $$
declare
  correction text := nullif(current_setting('livescoring.correction', true), '');
begin
  if correction is not null
     and new.activity_id = old.activity_id and new.judge_id = old.judge_id and new.entry_id = old.entry_id
     and new.round_id is not distinct from old.round_id
     and exists (
       select 1 from public.score_corrections c
       where c.id::text = correction and c.status = 'approved'
         and c.judge_id = new.judge_id and c.entry_id = new.entry_id and c.round_id is not distinct from new.round_id
         and c.new_value = new.value and c.new_breakdown is not distinct from new.breakdown
     ) then
    return new;
  end if;
  raise exception 'Submitted scores cannot be changed';
end;
$$;

drop trigger if exists scores_final on public.scores;
create trigger scores_final
  before update on public.scores
  for each row execute function public.forbid_score_update();

-- Judges' notes -------------------------------------------------------------
-- One note per judge per entry (a candidate's note carries through a pageant), written on the judge's screen and read
-- by that judge and the organizer. Server only, like judge_access.

create table if not exists public.judge_notes (
  judge_id     uuid not null references public.judges (id) on delete cascade,
  entry_id     uuid not null references public.entries (id) on delete cascade,
  activity_id  uuid not null references public.activities (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  updated_at   timestamptz not null default now(),
  primary key (judge_id, entry_id)
);
create index if not exists judge_notes_activity_idx on public.judge_notes (activity_id);

-- Judges' signatures ---------------------------------------------------------
-- Each judge's signature once they've deliberated (an event without live scoring). drawn: drawn on a touchscreen, kept
-- as SVG path data; checked: they ticked "(Sgd.)" on a screen without touch. Server only.

create table if not exists public.judge_signatures (
  judge_id     uuid primary key references public.judges (id) on delete cascade,
  activity_id  uuid not null references public.activities (id) on delete cascade,
  method       text not null check (method in ('drawn', 'checked')),
  drawing      text check (char_length(drawing) between 1 and 20000),
  signed_at    timestamptz not null default now(),
  check ((method = 'drawn') = (drawing is not null))
);
create index if not exists judge_signatures_activity_idx on public.judge_signatures (activity_id);

-- The judges signed the scores as they were: a score that changes after that voids every signature.
create or replace function public.void_signatures() returns trigger
language plpgsql
as $$
begin
  if new.value is distinct from old.value or new.breakdown is distinct from old.breakdown then
    delete from public.judge_signatures where activity_id = new.activity_id;
  end if;
  return null;
end;
$$;
drop trigger if exists void_signatures on public.scores;
create trigger void_signatures after update on public.scores for each row execute function public.void_signatures();

-- Score corrections ------------------------------------------------------------
-- A judge who entered a wrong score asks to change it; it changes only if every other judge on their panel agrees
-- (or, for a judge alone on their panel, the organizer approves). Server only.

create table if not exists public.score_corrections (
  id             uuid primary key default gen_random_uuid(),
  activity_id    uuid not null references public.activities (id) on delete cascade,
  judge_id       uuid not null references public.judges (id) on delete cascade,
  entry_id       uuid not null references public.entries (id) on delete cascade,
  round_id       uuid references public.rounds (id) on delete cascade,
  old_value      numeric(8, 3) not null,
  new_value      numeric(8, 3) not null,
  old_breakdown  jsonb,
  new_breakdown  jsonb,
  reason         text not null check (char_length(reason) between 1 and 300),
  status         text not null default 'open' check (status in ('open', 'approved', 'rejected', 'withdrawn')),
  -- Who settled it: the judges' votes, or the organizer (a judge alone on their panel).
  decided_by     text check (decided_by in ('judges', 'organizer')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index if not exists score_corrections_activity_idx on public.score_corrections (activity_id, created_at);
-- Three decimal places, on databases set up before them.
alter table public.scores alter column value type numeric(8, 3);
alter table public.score_corrections alter column old_value type numeric(8, 3);
alter table public.score_corrections alter column new_value type numeric(8, 3);
-- One open request per score at a time.
create unique index if not exists score_corrections_one_open
  on public.score_corrections (judge_id, entry_id, coalesce(round_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

create table if not exists public.correction_votes (
  correction_id  uuid not null references public.score_corrections (id) on delete cascade,
  judge_id       uuid not null references public.judges (id) on delete cascade,
  activity_id    uuid not null references public.activities (id) on delete cascade,
  agree          boolean not null,
  created_at     timestamptz not null default now(),
  primary key (correction_id, judge_id)
);
create index if not exists correction_votes_activity_idx on public.correction_votes (activity_id);

-- Settles an open correction, once: turned down, or approved and the score changed, in one transaction (a score that
-- won't fit its rules undoes the whole thing). The only way a submitted score changes (see forbid_score_update). False
-- when it was no longer open, e.g. two last votes at once.
create or replace function public.settle_score_correction(correction uuid, outcome text, decider text)
returns boolean
language plpgsql
as $$
declare
  c public.score_corrections%rowtype;
begin
  if outcome not in ('approved', 'rejected') or decider not in ('judges', 'organizer') then
    raise exception 'Unknown outcome % by %', outcome, decider;
  end if;
  update public.score_corrections set status = outcome, decided_by = decider, decided_at = now()
    where id = correction and status = 'open'
    returning * into c;
  if not found then
    return false;
  end if;
  if outcome = 'approved' then
    perform set_config('livescoring.correction', correction::text, true);
    update public.scores set value = c.new_value, breakdown = c.new_breakdown
      where judge_id = c.judge_id and entry_id = c.entry_id and round_id is not distinct from c.round_id;
    perform set_config('livescoring.correction', '', true);
  end if;
  return true;
end;
$$;
-- Only the server settles corrections.
revoke execute on function public.settle_score_correction(uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.settle_score_correction(uuid, text, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_score_correction(uuid, text, text) to service_role;
  end if;
end;
$$;

-- Row level security ---------------------------------------------------------
-- None of these tables has a policy, so only the secret key (the server) can read or write them. The public key
-- reads only activity_changes (see Realtime below).

alter table public.admins       enable row level security;
alter table public.activities   enable row level security;
alter table public.judges       enable row level security;
alter table public.judge_access enable row level security;
alter table public.judge_devices enable row level security;
alter table public.sign_in_failures enable row level security;
alter table public.judge_notes enable row level security;
alter table public.score_corrections enable row level security;
alter table public.correction_votes enable row level security;
alter table public.judge_signatures enable row level security;
alter table public.entries      enable row level security;
alter table public.scores       enable row level security;
alter table public.rounds       enable row level security;
alter table public.activity_drafts enable row level security;
alter table public.deductions   enable row level security;

-- The results tables are server-only: the public key reads none of them (scores stay private until the app shows
-- them). Databases set up before migration 016 had a public read policy on each; these drop it.
drop policy if exists "Public read" on public.activities;
drop policy if exists "Public read" on public.judges;
drop policy if exists "Public read" on public.entries;
drop policy if exists "Public read" on public.scores;
drop policy if exists "Public read" on public.rounds;

-- Realtime -------------------------------------------------------------------
-- Open screens hear that an activity changed, never what changed: one row per activity with the time it last
-- changed, kept up to date by triggers on every write to its settings, judges, entries, scores and program. The
-- screens then reload their data from the server. No link to activities, so a deleted one's last change remains.

create table if not exists public.activity_changes (
  activity_id  uuid primary key,
  changed_at   timestamptz not null default now()
);
alter table public.activity_changes enable row level security;
drop policy if exists "Public read" on public.activity_changes;
create policy "Public read" on public.activity_changes for select to anon, authenticated using (true);

create or replace function public.note_activity_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed uuid;
begin
  if tg_table_name = 'activities' then
    changed := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    changed := case when tg_op = 'DELETE' then old.activity_id else new.activity_id end;
  end if;
  insert into public.activity_changes (activity_id, changed_at) values (changed, clock_timestamp())
    on conflict (activity_id) do update set changed_at = excluded.changed_at;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'judges', 'entries', 'scores', 'rounds', 'score_corrections', 'correction_votes', 'judge_signatures'] loop
    execute format('drop trigger if exists note_activity_change on public.%I', t);
    execute format('create trigger note_activity_change after insert or update or delete on public.%I for each row execute function public.note_activity_change()', t);
    -- Databases set up before migration 016 sent these tables over realtime.
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_changes') then
    alter publication supabase_realtime add table public.activity_changes;
  end if;
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
