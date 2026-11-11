-- Pageants as they run: the preliminary and pageant proper as sessions of their own, and sub-activities that deliberate
-- instead of scoring live.
--
-- activities.preliminary_ended_at, proper_started_at: a pageant's session runs from the preliminary's start
-- (session_started_at) to pageant proper's end (session_state 'ended'). In between, the preliminary ends on its own (its
-- judges' part is over) and pageant proper starts on its own. check_score holds each segment's scores to its session,
-- and judges_locked (with set_judge_chair) lets pageant proper's own judges change until pageant proper starts.
--
-- rounds.live_scoring, rounds.deliberation_started_at, round_signatures, round_signoffs: a sub-activity can keep its
-- scores from the audience until its judges have reviewed and signed them, and the organizer has too. A score that
-- changes after that voids the sub-activity's signatures and sign-off.
--
-- Run in the Supabase SQL editor after 039, or let the release pipeline run it. Safe to run again. On a brand-new
-- database this does nothing, and schema.sql creates it.

do $migration$
declare
  t text;
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists preliminary_ended_at timestamptz;
  alter table public.activities add column if not exists proper_started_at timestamptz;
  alter table public.rounds add column if not exists live_scoring boolean not null default true;
  alter table public.rounds add column if not exists deliberation_started_at timestamptz;

  -- A pageant already judging pageant proper (or ended) carries on there: both its segments are under way. One still
  -- in its preliminary carries on in the preliminary.
  update public.activities a
     set preliminary_ended_at = coalesce(a.session_started_at, now()), proper_started_at = coalesce(a.session_started_at, now())
   where a.kind = 'pageant'
     and a.session_state <> 'draft'
     and a.preliminary_ended_at is null
     and a.proper_started_at is null
     and (a.session_state = 'ended'
          or exists (select 1 from public.rounds r where r.id = a.current_round_id and r.segment = 'proper')
          or exists (select 1 from public.scores s join public.rounds r on r.id = s.round_id where s.activity_id = a.id and r.segment = 'proper'));

  create table if not exists public.round_signatures (
    round_id     uuid not null references public.rounds (id) on delete cascade,
    judge_id     uuid not null references public.judges (id) on delete cascade,
    activity_id  uuid not null references public.activities (id) on delete cascade,
    method       text not null check (method in ('drawn', 'checked')),
    drawing      text check (char_length(drawing) between 1 and 20000),
    signed_at    timestamptz not null default now(),
    primary key (round_id, judge_id),
    check ((method = 'drawn') = (drawing is not null))
  );
  create index if not exists round_signatures_activity_idx on public.round_signatures (activity_id);

  create table if not exists public.round_signoffs (
    round_id     uuid primary key references public.rounds (id) on delete cascade,
    activity_id  uuid not null references public.activities (id) on delete cascade,
    signed_by    text not null check (char_length(signed_by) between 1 and 120),
    method       text not null check (method in ('drawn', 'checked')),
    drawing      text check (char_length(drawing) between 1 and 20000),
    signed_at    timestamptz not null default now(),
    check ((method = 'drawn') = (drawing is not null))
  );
  create index if not exists round_signoffs_activity_idx on public.round_signoffs (activity_id);

  alter table public.round_signatures enable row level security;
  alter table public.round_signoffs enable row level security;

  create or replace function public.void_round_signatures() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.round_id is not null and (new.value is distinct from old.value or new.breakdown is distinct from old.breakdown) then
      delete from public.round_signatures where round_id = new.round_id;
      delete from public.round_signoffs where round_id = new.round_id;
    end if;
    return null;
  end;
  $fn$;
  drop trigger if exists void_round_signatures on public.scores;
  create trigger void_round_signatures after update on public.scores for each row execute function public.void_round_signatures();

  create or replace function public.check_score()
  returns trigger
  language plpgsql
  as $fn$
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
    -- A new score only while judging is live: not one that arrives as the session ends or the deliberation starts. A
    -- correction (an update) is settled later, in the deliberation too.
    if tg_op = 'INSERT' and a.session_state is distinct from 'live' then
      raise exception 'Judging is not open' using errcode = '55000';
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
      -- A pageant's segments are sessions of their own: the preliminary scores until it ends, pageant proper once it
      -- has started.
      if tg_op = 'INSERT' and r.segment = 'preliminary' and a.preliminary_ended_at is not null then
        raise exception 'The preliminary has ended' using errcode = '55000';
      end if;
      if tg_op = 'INSERT' and r.segment = 'proper' and a.proper_started_at is null then
        raise exception 'Pageant proper has not started' using errcode = '55000';
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
  $fn$;

  create or replace function public.check_judges_locked()
  returns trigger
  language plpgsql
  as $fn$
  declare
    a public.activities%rowtype;
  begin
    -- The activity being deleted takes its judges with it.
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;
    select * into a from public.activities where id = coalesce(new.activity_id, old.activity_id);
    if found and (a.session_state <> 'draft' or a.session_started_at is not null)
       -- A pageant's own pageant proper judges can still change while the preliminary runs, until pageant proper starts.
       and not (a.kind = 'pageant' and a.session_state = 'live' and a.proper_started_at is null and coalesce(new.panel, old.panel) = 'proper') then
      raise exception 'The session has started, so the panel of judges is locked.' using errcode = '55000';
    end if;
    return coalesce(new, old);
  end;
  $fn$;

  create or replace function public.set_judge_chair(judge uuid) returns void
  language plpgsql
  as $fn$
  declare
    activity uuid;
    j public.judges%rowtype;
  begin
    select * into j from public.judges where id = judge;
    activity := j.activity_id;
    -- Holds the activity until the chair has changed: a session starting meanwhile waits, then starts with it. Pageant
    -- proper's own board can still change while the preliminary runs, until pageant proper starts.
    perform 1 from public.activities a
     where a.id = activity
       and (a.session_state = 'draft' or (j.panel = 'proper' and a.kind = 'pageant' and a.session_state = 'live' and a.proper_started_at is null))
       for share;
    if not found then
      raise exception 'The session has started, so the panel of judges is locked.' using errcode = '55000';
    end if;
    select * into j from public.judges where id = judge for update;
    if j.is_chair then
      return;
    end if;
    -- From the chair of the same segments, so each board still has exactly one.
    update public.judges set is_chair = false where activity_id = activity and panel = j.panel and is_chair;
    if not found then
      raise exception 'Only a judge on the same segments as a chair can take over as chair.';
    end if;
    update public.judges set is_chair = true where id = judge;
  end;
  $fn$;

  -- Open screens hear of signatures and sign-offs as of everything else (see note_activity_change).
  if to_regprocedure('public.note_activity_change()') is not null then
    foreach t in array array['round_signatures', 'round_signoffs'] loop
      execute format('drop trigger if exists note_activity_change on public.%I', t);
      execute format('create trigger note_activity_change after insert or update or delete on public.%I for each row execute function public.note_activity_change()', t);
    end loop;
  end if;
end;
$migration$;
