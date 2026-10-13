-- Results stay private until the app shows them. Browsers used to read the activities, judges, entries, scores and
-- rounds tables directly (with the public key), only so realtime could tell open screens that something changed; that
-- also let anyone read every score, each judge's included, before "Hide ranks" let the standings out. Now realtime
-- follows a small table that only says "this activity changed, at this time", kept up to date by triggers on every
-- write, and the public can no longer read the results tables at all. Pages load their data on the server, as before.
-- Run in the Supabase SQL editor after 015. Safe to run again.
-- The version of the app deployed before this one keeps working: its screens stop hearing realtime changes and fall back
-- to checking every few seconds, until the new version is deployed.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
declare
  t text;
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  -- One row per activity: when it last changed. No link to activities, so deleting one still leaves its last change
  -- for open screens to hear (they then find it gone).
  create table if not exists public.activity_changes (
    activity_id  uuid primary key,
    changed_at   timestamptz not null default now()
  );
  alter table public.activity_changes enable row level security;
  drop policy if exists "Public read" on public.activity_changes;
  create policy "Public read" on public.activity_changes for select to anon, authenticated using (true);

  -- Whatever changes in an activity (its settings, judges, entries, scores or program) marks it changed.
  create or replace function public.note_activity_change() returns trigger
  language plpgsql security definer set search_path = public as $fn$
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
  $fn$;

  foreach t in array array['activities', 'judges', 'entries', 'scores', 'rounds'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists note_activity_change on public.%I', t);
      execute format('create trigger note_activity_change after insert or update or delete on public.%I for each row execute function public.note_activity_change()', t);
      -- The results tables are server-only from here on: no public read, and nothing for realtime to send.
      execute format('drop policy if exists "Public read" on public.%I', t);
      if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end if;
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_changes') then
    alter publication supabase_realtime add table public.activity_changes;
  end if;
end;
$migration$;
