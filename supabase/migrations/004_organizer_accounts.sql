-- Organizer accounts managed by the super admin, activity ownership, and LED wall display settings.
-- Run in the Supabase SQL editor after 003. Safe to run again.
-- Additive only: the version of the app already deployed keeps working after this runs.

-- Organizer (admin) accounts. No row level security policies: only the server's secret key can
-- read them, so emails and password hashes never reach a browser.
create table if not exists public.admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  name           text not null check (length(btrim(name)) > 0),
  photo_path     text,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Which organizer an activity belongs to. Null: managed by the super admin only.
-- Deleting an organizer hands their activities back to the super admin instead of deleting them.
alter table if exists public.activities
  add column if not exists owner_id uuid references public.admins (id) on delete set null;
do $$
begin
  if to_regclass('public.activities') is not null then
    create index if not exists activities_owner_idx on public.activities (owner_id);
  end if;
end;
$$;

-- LED wall: full-screen scoresheet instead of the green screen overlay,
-- and holding back scores until every judge has scored the entry on air.
alter table if exists public.activities
  add column if not exists led_fullscreen boolean not null default false;
alter table if exists public.activities
  add column if not exists led_hold_scores boolean not null default false;

-- Organizer photos: a public bucket; only the server uploads.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('organizer-photos', 'organizer-photos', true)
    on conflict (id) do nothing;
  end if;
end;
$$;
