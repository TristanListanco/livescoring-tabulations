-- An entry the organizer marks withdrawn: it can't go on (it withdrew, fell ill, was disqualified).
--
-- entries.withdrawn_at, entries.withdrawn_reason: set together (a reason of 1 to 120 characters), and cleared together
-- when it's reinstated. A withdrawn entry isn't ranked or waited for, and can't be scored: check_score refuses a new
-- score for it (a correction to one it had still goes through), and check_deliberation doesn't wait for its scores.
-- The scores it had stay on record.
--
-- Run in the Supabase SQL editor after 042, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, entries can't be withdrawn. On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.entries') is null then
    return;
  end if;

  alter table public.entries add column if not exists withdrawn_at timestamptz;
  alter table public.entries add column if not exists withdrawn_reason text;
  if not exists (select 1 from pg_constraint where conname = 'entries_withdrawn_reason') then
    alter table public.entries add constraint entries_withdrawn_reason check (
      (withdrawn_at is null and withdrawn_reason is null)
      or (withdrawn_at is not null and char_length(btrim(withdrawn_reason)) between 1 and 120)
    );
  end if;

  create or replace function public.check_score()
  returns trigger
  language plpgsql
  as $fn$
  declare
    a public.activities%rowtype;
    e public.entries%rowtype;
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
    select * into e from public.entries where id = new.entry_id and activity_id = new.activity_id;
    if not found then
      raise exception 'Entry does not belong to this activity';
    end if;
    -- A withdrawn entry gets no new scores (a correction to one it had still goes through).
    if tg_op = 'INSERT' and e.withdrawn_at is not null then
      raise exception 'This entry has withdrawn' using errcode = '55000';
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

  create or replace function public.check_deliberation() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.session_state = 'deliberation' and old.session_state is distinct from 'deliberation'
       and (new.live_scoring or new.kind <> 'event') then
      raise exception 'Only an event without live scoring has a deliberation.';
    end if;
    -- It starts (or starts again) only once every judge has scored every entry still in (not withdrawn): no one can
    -- score during it.
    if new.session_state = 'deliberation' and old.session_state is distinct from 'deliberation' and exists (
      select 1 from public.entries e join public.judges j on j.activity_id = e.activity_id
      where e.activity_id = new.id
        and e.withdrawn_at is null
        and not exists (select 1 from public.scores s where s.entry_id = e.id and s.judge_id = j.id and s.round_id is null)
    ) then
      raise exception 'Every judge scores every entry before the deliberation.' using errcode = '55000';
    end if;
    if old.session_state = 'deliberation' and new.session_state = 'ended' and exists (
      select 1 from public.judges j
      where j.activity_id = new.id and not exists (select 1 from public.judge_signatures s where s.judge_id = j.id)
    ) then
      raise exception 'Every judge signs before the session ends.';
    end if;
    if old.session_state = 'deliberation' and new.session_state = 'ended'
       and not exists (select 1 from public.activity_signoffs o where o.activity_id = new.id) then
      raise exception 'The organizer signs before the session ends.';
    end if;
    return new;
  end;
  $fn$;
end;
$migration$;
