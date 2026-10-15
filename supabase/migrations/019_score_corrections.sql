-- Score corrections: a judge who entered a wrong score asks to change it, and it changes only if every other judge on
-- their panel agrees (or, for a judge alone on their panel, the organizer approves). Submitted scores stay final
-- otherwise: the database still refuses any other change to a score.
-- Run in the Supabase SQL editor after 018. Safe to run again.
-- Additive: the version of the app already deployed ignores the new tables, and scores stay final either way. Until
-- it's run, the new version doesn't offer corrections.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
declare
  t text;
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  create table if not exists public.score_corrections (
    id             uuid primary key default gen_random_uuid(),
    activity_id    uuid not null references public.activities (id) on delete cascade,
    judge_id       uuid not null references public.judges (id) on delete cascade,
    entry_id       uuid not null references public.entries (id) on delete cascade,
    round_id       uuid references public.rounds (id) on delete cascade,
    old_value      numeric(7, 2) not null,
    new_value      numeric(7, 2) not null,
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

  alter table public.score_corrections enable row level security;
  alter table public.correction_votes enable row level security;

  -- A corrected score still has to fit its rules.
  drop trigger if exists scores_check on public.scores;
  create trigger scores_check before insert or update on public.scores for each row execute function public.check_score();

  create or replace function public.forbid_score_update()
  returns trigger
  language plpgsql
  as $fn$
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
  $fn$;

  -- Settles an open correction, once: turned down, or approved and the score changed, in one transaction (a score that
  -- won't fit its rules undoes the whole thing). False when it was no longer open, e.g. two last votes at once.
  create or replace function public.settle_score_correction(correction uuid, outcome text, decider text)
  returns boolean
  language plpgsql
  as $fn$
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
  $fn$;
  -- Only the server settles corrections.
  revoke execute on function public.settle_score_correction(uuid, text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.settle_score_correction(uuid, text, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_score_correction(uuid, text, text) to service_role;
  end if;

  -- Judges' screens and the desk hear about requests and votes, as they do about scores.
  foreach t in array array['score_corrections', 'correction_votes'] loop
    execute format('drop trigger if exists note_activity_change on public.%I', t);
    execute format('create trigger note_activity_change after insert or update or delete on public.%I for each row execute function public.note_activity_change()', t);
  end loop;
end;
$migration$;
