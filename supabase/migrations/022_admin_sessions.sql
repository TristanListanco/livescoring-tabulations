-- Admin sessions that can be ended. Signing in to the admin panel used to make a signed cookie that stayed good until it
-- expired (12 hours) unless the password changed: signing out removed it from that browser only, so a copy of it kept
-- working. Now each sign-in is a row here, and the cookie carries the row's id: signing out deletes the row, which ends
-- the session wherever the cookie is. An organizer (and the super admin) can see the browsers signed in to their
-- account and sign any of them out.
-- Run in the Supabase SQL editor after 021. Safe to run again.
-- Until it's run, the new version signs admins in as before. Once it's run, sessions from before it end, and admins
-- sign in again once.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.admins') is null then
    return;
  end if;
  -- admin_id null: the super admin, who has no account row.
  create table if not exists public.admin_sessions (
    id          uuid primary key default gen_random_uuid(),
    admin_id    uuid references public.admins (id) on delete cascade,
    label       text not null default '' check (char_length(label) <= 80),
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
  );
  create index if not exists admin_sessions_admin_idx on public.admin_sessions (admin_id);
  alter table public.admin_sessions enable row level security;
end;
$migration$;
