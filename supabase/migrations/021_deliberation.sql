-- Live scoring or a deliberation, judges' signatures, and three decimal places.
--
-- An event either has live scoring (the default, as before): the audience sees scores as they come in, and a submitted
-- score is final. Or it doesn't: the audience sees no scores until the judges have signed, a judge can ask to correct a
-- score (the others vote on it without seeing the values), and once every entry is scored the judges deliberate:
-- each reviews their scores and notes, then signs, by drawing their signature on a touchscreen or ticking "(Sgd.)".
-- The session ends only once every judge has signed, and a score corrected after that voids the signatures.
-- Judges can also enter scores with three decimal places. And two indexes, for many activities running at once, and a
-- rule that a session with scores can't go back to not started.
--
-- Run in the Supabase SQL editor after 020. Safe to run again.
-- The version of the app already deployed keeps working: every activity keeps live scoring until the new version
-- changes it, and nothing it does reaches the new session state.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  -- Three decimal places: allowed for activities (events), and kept by scores and corrections.
  alter table public.activities drop constraint if exists activities_decimals_check;
  alter table public.activities add constraint activities_decimals_check check (decimals in (0, 1, 2, 3));
  alter table public.scores alter column value type numeric(8, 3);
  alter table public.score_corrections alter column old_value type numeric(8, 3);
  alter table public.score_corrections alter column new_value type numeric(8, 3);

  -- Live scoring, and the deliberation between live and ended for an event without it. signed_off_at: when the session
  -- ended with every judge's signature, which is when an event without live scoring shows its results.
  alter table public.activities add column if not exists live_scoring boolean not null default true;
  alter table public.activities add column if not exists signed_off_at timestamptz;
  alter table public.activities drop constraint if exists activities_session_state_check;
  alter table public.activities
    add constraint activities_session_state_check check (session_state in ('draft', 'live', 'deliberation', 'ended'));

  -- Each judge's signature, once they've deliberated. drawn: drawn on a touchscreen, kept as SVG path data;
  -- checked: they ticked "(Sgd.)" on a screen without touch. Server only.
  create table if not exists public.judge_signatures (
    judge_id     uuid primary key references public.judges (id) on delete cascade,
    activity_id  uuid not null references public.activities (id) on delete cascade,
    method       text not null check (method in ('drawn', 'checked')),
    drawing      text check (char_length(drawing) between 1 and 20000),
    signed_at    timestamptz not null default now(),
    check ((method = 'drawn') = (drawing is not null))
  );
  create index if not exists judge_signatures_activity_idx on public.judge_signatures (activity_id);
  alter table public.judge_signatures enable row level security;
  drop trigger if exists note_activity_change on public.judge_signatures;
  create trigger note_activity_change after insert or update or delete on public.judge_signatures
    for each row execute function public.note_activity_change();

  -- The judges signed the scores as they were: a score that changes after that voids every signature.
  create or replace function public.void_signatures() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.value is distinct from old.value or new.breakdown is distinct from old.breakdown then
      delete from public.judge_signatures where activity_id = new.activity_id;
    end if;
    return null;
  end;
  $fn$;
  drop trigger if exists void_signatures on public.scores;
  create trigger void_signatures after update on public.scores for each row execute function public.void_signatures();

  -- Only an event without live scoring deliberates, and its session ends from deliberation only once every judge has signed.
  create or replace function public.check_deliberation() returns trigger
  language plpgsql
  as $fn$
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
  $fn$;
  drop trigger if exists check_deliberation on public.activities;
  create trigger check_deliberation before update on public.activities for each row execute function public.check_deliberation();

  -- A session goes back to not started only once its scores are gone (Reset scores, on a test site, deletes them
  -- first). Otherwise reopening its judges, running order and program would let the results be changed after scoring.
  create or replace function public.check_session_restart() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.session_state = 'draft' and old.session_state is distinct from 'draft'
       and exists (select 1 from public.scores s where s.activity_id = new.id) then
      raise exception 'A session with scores can''t go back to not started.';
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists check_session_restart on public.activities;
  create trigger check_session_restart before update on public.activities for each row execute function public.check_session_restart();

  -- Many activities at once (breakout sessions): every judge's screen reads that judge's scores, and every screen an
  -- activity's correction votes, after each change. Indexed, so those stay quick however many activities there are.
  create index if not exists scores_judge_idx on public.scores (judge_id);
  if to_regclass('public.correction_votes') is not null then
    create index if not exists correction_votes_activity_idx on public.correction_votes (activity_id);
  end if;
end;
$migration$;
