-- Pageant sub-activities with parts (e.g. a closed-door interview scored on its Q&A, the advocacy and the advocacy
-- video, each with its own scoring), and saved drafts of activities still being set up.
-- Run in the Supabase SQL editor after 011. Safe to run again.
-- Additive only: the version of the app already deployed ignores the new column and table.
-- On a brand-new database (e.g. the CI stack) there is nothing to update yet: this does nothing, and schema.sql
-- creates it all.

do $migration$
begin
  if to_regclass('public.rounds') is null or to_regclass('public.admins') is null then
    return;
  end if;

  -- A part of a sub-activity. The sub-activity itself is then only a container: judges score its parts.
  alter table public.rounds add column if not exists parent_id uuid references public.rounds (id) on delete cascade;
  create index if not exists rounds_parent_idx on public.rounds (parent_id);

  -- Drafts of activities being set up, saved from the create form. Server only (no row level security policies),
  -- like admins: an organizer's drafts are theirs; owner_id null is the super admin's.
  create table if not exists public.activity_drafts (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid references public.admins (id) on delete cascade,
    kind        text not null check (kind in ('event', 'pageant')),
    name        text not null default '',
    data        jsonb not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  );
  create index if not exists activity_drafts_owner_idx on public.activity_drafts (owner_id, updated_at desc);
  alter table public.activity_drafts enable row level security;
end;
$migration$;
