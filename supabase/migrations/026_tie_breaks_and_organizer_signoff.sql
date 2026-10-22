-- The deliberation's last steps, in an event without live scoring.
--
-- tie_breaks: every tie in the ranking is broken before the judges sign. The chair of the board of judges puts the
-- tied entries in order and says why; the scores stay as given. A break holds while exactly those entries stay tied.
-- Breaking (or changing) one after judges have signed voids their signatures, so every judge signs the order the
-- results print.
--
-- activity_signoffs: the organizer signs the results (drawn, or "(Sgd.)") as they end the session. A session ends from
-- the deliberation only with every judge's signature and the organizer's.
--
-- Run in the Supabase SQL editor after 025, or let the release pipeline run it. Safe to run again. Additive: the
-- version of the app already deployed ignores the new tables; it can't end a deliberated session until it's updated.
-- On a brand-new database this does nothing, and schema.sql creates it.

do $migration$
declare
  t text;
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  create table if not exists public.tie_breaks (
    activity_id  uuid not null references public.activities (id) on delete cascade,
    -- The tied entries as a set (their ids sorted, joined with commas): one break per tie.
    tie_key      text not null,
    -- The tied entries in the order the chair put them, highest first.
    entry_ids    uuid[] not null,
    reason       text not null check (char_length(reason) between 1 and 300),
    judge_id     uuid references public.judges (id) on delete set null,
    created_at   timestamptz not null default now(),
    primary key (activity_id, tie_key)
  );
  alter table public.tie_breaks enable row level security;

  -- The judges sign the order the results print: breaking a tie after they have voids their signatures.
  create or replace function public.void_signatures_on_tie_break() returns trigger
  language plpgsql
  as $fn$
  begin
    delete from public.judge_signatures
      where activity_id = case when tg_op = 'DELETE' then old.activity_id else new.activity_id end;
    return null;
  end;
  $fn$;
  drop trigger if exists void_signatures on public.tie_breaks;
  create trigger void_signatures after insert or update or delete on public.tie_breaks for each row execute function public.void_signatures_on_tie_break();

  create table if not exists public.activity_signoffs (
    activity_id  uuid primary key references public.activities (id) on delete cascade,
    -- Who signed: the organizer's name as their account has it, or "Super admin".
    signed_by    text not null check (char_length(signed_by) between 1 and 120),
    method       text not null check (method in ('drawn', 'checked')),
    drawing      text check (char_length(drawing) between 1 and 20000),
    signed_at    timestamptz not null default now(),
    check ((method = 'drawn') = (drawing is not null))
  );
  alter table public.activity_signoffs enable row level security;

  -- Judges' screens and the desk hear about breaks and the sign-off, as they do about scores.
  foreach t in array array['tie_breaks', 'activity_signoffs'] loop
    execute format('drop trigger if exists note_activity_change on public.%I', t);
    execute format('create trigger note_activity_change after insert or update or delete on public.%I for each row execute function public.note_activity_change()', t);
  end loop;

  -- Only an event without live scoring deliberates, and its session ends from deliberation only once every judge has
  -- signed, and the organizer.
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
    if old.session_state = 'deliberation' and new.session_state = 'ended'
       and not exists (select 1 from public.activity_signoffs o where o.activity_id = new.id) then
      raise exception 'The organizer signs before the session ends.';
    end if;
    return new;
  end;
  $fn$;
end;
$migration$;
