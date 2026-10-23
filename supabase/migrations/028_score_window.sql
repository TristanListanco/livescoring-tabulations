-- A score arrives in a window, not at an instant.
--
-- Late scores: the database itself refuses a new score unless judging is live, so one that arrives just as the session
-- ends (or the deliberation starts) can't slip in after the app checked. Corrections are updates, settled later, and
-- aren't affected.
--
-- The undo window: a judge's confirmed score waits a few seconds (to be undone) before it's sent. If the organizer moves
-- on meanwhile, it used to be refused. Now the activity keeps the entry on screen before this one and when judges were
-- moved on from it, and the app accepts that entry's score for a few seconds after the move (events only).
--
-- Run in the Supabase SQL editor after 027, or let the release pipeline run it. Safe to run again. Additive: the
-- version of the app already deployed ignores the new columns and checks the session itself. On a brand-new database
-- this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.scores') is null then
    return;
  end if;

  alter table public.activities add column if not exists previous_entry_id uuid references public.entries (id) on delete set null;
  alter table public.activities add column if not exists entry_shown_at timestamptz;

  create or replace function public.note_entry_shown()
  returns trigger
  language plpgsql
  as $fn$
  begin
    if new.current_entry_id is distinct from old.current_entry_id then
      new.previous_entry_id := old.current_entry_id;
      new.entry_shown_at := now();
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists activities_entry_shown on public.activities;
  create trigger activities_entry_shown
    before update of current_entry_id on public.activities
    for each row execute function public.note_entry_shown();

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
end;
$migration$;
