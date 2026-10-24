-- Session changes the database makes whole, and the rules it now keeps itself.
--
-- Some changes took several writes from the app, and a failure between them left them half done. Deliberating again
-- could leave the old signatures in place (the session could then end again without anyone signing anew), and
-- archiving could leave judges' devices signed in. These now happen in the same write as the change itself:
-- - leaving an ended session (reopening it, deliberating again, resetting it) clears the judges' signatures, the
--   organizer's and when it was signed off;
-- - archiving signs every judge's device out, and their screens hear of it.
-- And the database keeps rules the app followed on its own, where a check and the change it guarded could cross:
-- - the deliberation starts only once every judge has scored every entry, and no entry is added during it;
-- - a judge has at most one approved device (two approvals crossing used to leave two). Any judge with two now keeps
--   the one approved last.
-- Deductions count as a change to their pageant, so every open desk hears of them. And activity_changes forgets
-- activities that no longer exist (the app now removes an activity's row when it deletes it).
--
-- Run in the Supabase SQL editor after 028, or let the release pipeline run it. Safe to run again. Additive: the
-- version of the app already deployed makes the same changes itself, so they simply happen twice. On a brand-new
-- database this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activity_signoffs') is null or to_regclass('public.deductions') is null then
    return;
  end if;

  create or replace function public.check_deliberation() returns trigger
  language plpgsql
  as $fn$
  begin
    if new.session_state = 'deliberation' and old.session_state is distinct from 'deliberation'
       and (new.live_scoring or new.kind <> 'event') then
      raise exception 'Only an event without live scoring has a deliberation.';
    end if;
    -- It starts (or starts again) only once every judge has scored every entry: no one can score during it.
    if new.session_state = 'deliberation' and old.session_state is distinct from 'deliberation' and exists (
      select 1 from public.entries e join public.judges j on j.activity_id = e.activity_id
      where e.activity_id = new.id
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

  -- Session changes the database makes whole (migration 029), each in the same write as the change itself:
  -- - leaving an ended session (reopening it, deliberating again, resetting it) takes back the judges' signatures, the
  --   organizer's and when it was signed off, so it can't end again on the old ones;
  -- - archiving signs every judge's device out, and their screens hear of it;
  -- - no entry is added while the judges deliberate: no one could score it.
  create or replace function public.clear_signatures_on_reopen() returns trigger
  language plpgsql
  as $fn$
  begin
    if old.session_state = 'ended' and new.session_state is distinct from 'ended' then
      new.signed_off_at := null;
      delete from public.judge_signatures where activity_id = new.id;
      delete from public.activity_signoffs where activity_id = new.id;
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists clear_signatures_on_reopen on public.activities;
  create trigger clear_signatures_on_reopen
    before update of session_state on public.activities
    for each row execute function public.clear_signatures_on_reopen();
  create or replace function public.sign_out_on_archive() returns trigger
  language plpgsql
  as $fn$
  begin
    if old.archived_at is null and new.archived_at is not null then
      delete from public.judge_devices d using public.judges j where d.judge_id = j.id and j.activity_id = new.id;
      update public.judges set devices_updated_at = now() where activity_id = new.id;
    end if;
    return null;
  end;
  $fn$;
  drop trigger if exists sign_out_on_archive on public.activities;
  create trigger sign_out_on_archive
    after update of archived_at on public.activities
    for each row execute function public.sign_out_on_archive();
  create or replace function public.check_entry_added() returns trigger
  language plpgsql
  as $fn$
  begin
    if exists (select 1 from public.activities a where a.id = new.activity_id and a.session_state = 'deliberation') then
      raise exception 'No entry can be added during the deliberation.' using errcode = '55000';
    end if;
    return new;
  end;
  $fn$;
  drop trigger if exists check_entry_added on public.entries;
  create trigger check_entry_added
    before insert on public.entries
    for each row execute function public.check_entry_added();

  update public.judge_devices d set status = 'revoked', decided_at = now()
  where d.status = 'approved' and exists (
    select 1 from public.judge_devices o
    where o.judge_id = d.judge_id and o.status = 'approved'
      and (coalesce(o.decided_at, o.created_at), o.id) > (coalesce(d.decided_at, d.created_at), d.id)
  );
  -- A judge has at most one approved device: approving one revokes the rest (migration 029 made it a rule, so two
  -- approvals crossing can't leave two).
  create unique index if not exists judge_devices_one_approved_idx on public.judge_devices (judge_id) where status = 'approved';

  drop trigger if exists note_activity_change on public.deductions;
  create trigger note_activity_change after insert or update or delete on public.deductions
    for each row execute function public.note_activity_change();

  delete from public.activity_changes c where not exists (select 1 from public.activities a where a.id = c.activity_id);
end;
$migration$;
