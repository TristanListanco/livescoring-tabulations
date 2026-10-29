-- Judges call the organizer for help; judges can see the overall ranking while they deliberate; judges' phones and
-- tablets hide their screens when tilted away.
--
-- - assistance_requests: a judge's call for help, from their screen, until the organizer answers it ("On my way") or
--   the judge cancels it. One open call per judge. Server only, like the rest; each call and answer counts as a change
--   to its activity, so the organizer's panel and the judge's screen hear of it over realtime.
-- - activities.judges_see_ranking: in the deliberation, judges see each entry's rank and average (never each other's
--   scores). Off unless the organizer turns it on.
-- - activities.privacy_screen: judges' phones and tablets hide the screen when tilted off axis while judging. On for
--   new activities; the activities there already are keep it off, so no judge is surprised by it mid-event.
--
-- Run in the Supabase SQL editor after 031, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, the app leaves these out (no Assist me, no ranking, no privacy screen). On a brand-new database this does
-- nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.activities') is null then
    return;
  end if;

  alter table public.activities add column if not exists judges_see_ranking boolean not null default false;
  if not exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'privacy_screen'
  ) then
    alter table public.activities add column privacy_screen boolean not null default false;
    alter table public.activities alter column privacy_screen set default true;
  end if;

  create table if not exists public.assistance_requests (
    id            uuid primary key default gen_random_uuid(),
    activity_id   uuid not null references public.activities (id) on delete cascade,
    judge_id      uuid not null references public.judges (id) on delete cascade,
    created_at    timestamptz not null default now(),
    -- The organizer is on the way.
    answered_at   timestamptz,
    -- The judge no longer needs it.
    cancelled_at  timestamptz
  );
  create unique index if not exists assistance_one_open_idx on public.assistance_requests (judge_id) where answered_at is null and cancelled_at is null;
  create index if not exists assistance_open_idx on public.assistance_requests (activity_id) where answered_at is null and cancelled_at is null;
  alter table public.assistance_requests enable row level security;
  drop trigger if exists note_activity_change on public.assistance_requests;
  create trigger note_activity_change after insert or update or delete on public.assistance_requests
    for each row execute function public.note_activity_change();
end;
$migration$;
