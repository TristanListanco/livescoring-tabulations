-- In an event without live scoring, a judge corrects their own score: no one votes, since the scores stay with the
-- judges until each has reviewed and signed theirs. The correction is still recorded with its reason (the results PDF
-- lists it) and still the only way a submitted score changes: settle_score_correction applies it, now decided by the
-- judge ('judge'), as well as by the judges' votes or the organizer (a pageant's corrections).
--
-- Run in the Supabase SQL editor after 024, or let the release pipeline run it. Safe to run again. Additive: the
-- version of the app already deployed never asks for 'judge'. On a brand-new database this does nothing, and
-- schema.sql creates it.

do $migration$
begin
  if to_regclass('public.score_corrections') is null then
    return;
  end if;

  -- Who settled it: the judge themself (an event without live scoring), the judges' votes, or the organizer (a judge
  -- alone on their panel).
  alter table public.score_corrections drop constraint if exists score_corrections_decided_by_check;
  alter table public.score_corrections add constraint score_corrections_decided_by_check check (decided_by in ('judges', 'organizer', 'judge'));

  create or replace function public.settle_score_correction(correction uuid, outcome text, decider text)
  returns boolean
  language plpgsql
  as $fn$
  declare
    c public.score_corrections%rowtype;
  begin
    if outcome not in ('approved', 'rejected') or decider not in ('judges', 'organizer', 'judge') then
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
end;
$migration$;
