-- The running order, written in one step that starting the session can't cut into.
--
-- The app checked that the session hadn't started, then wrote each entry's new place on its own: a session starting
-- in between could begin on half a new order, or change it after judging began. set_entry_order checks and writes
-- together, and a session starting meanwhile waits for it. Moving an entry and shuffling the order (an event's
-- running order drawn at random, until its session starts) both write through it.
--
-- Run in the Supabase SQL editor after 029, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the app writes the order itself, as before. On a brand-new database this does nothing, and schema.sql creates
-- it.

do $migration$
begin
  if to_regclass('public.entries') is null then
    return;
  end if;

  -- An activity's running order: these entries first, in this order, then any not listed (added meanwhile) in the
  -- order they had, numbered from 0. Only before its session starts.
  create or replace function public.set_entry_order(activity uuid, entry_ids uuid[]) returns void
  language plpgsql
  as $fn$
  begin
    -- Holds the activity until the order is written: a session starting meanwhile waits, then starts on it.
    perform 1 from public.activities a where a.id = activity and a.session_state = 'draft' for share;
    if not found then
      raise exception 'The running order is locked once the session has started.' using errcode = '55000';
    end if;
    update public.entries e set position = o.place
    from (
      select x.id, (row_number() over (order by l.n nulls last, x.position, x.created_at) - 1)::integer as place
      from public.entries x
      left join (select u.id, min(u.n) as n from unnest(entry_ids) with ordinality as u(id, n) group by u.id) l on l.id = x.id
      where x.activity_id = activity
    ) o
    where e.id = o.id and e.position is distinct from o.place;
  end;
  $fn$;
  -- Only the server sets the order.
  revoke execute on function public.set_entry_order(uuid, uuid[]) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.set_entry_order(uuid, uuid[]) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_entry_order(uuid, uuid[]) to service_role;
  end if;
end;
$migration$;
