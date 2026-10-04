-- LiveScoring schema. Paste into the Supabase SQL editor and run once.
-- All writes go through the Next.js server with the secret key; the browser
-- only reads public tables (for realtime) with the publishable key.

create extension if not exists pgcrypto;

-- Activities ---------------------------------------------------------------

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  public_id   text not null unique,
  min_score   numeric(7, 2) not null,
  max_score   numeric(7, 2) not null,
  decimals    smallint not null default 0 check (decimals in (0, 1, 2)),
  show_rank   boolean not null default true,
  created_at  timestamptz not null default now(),
  check (min_score >= 0),
  check (max_score > min_score)
);


-- Judges -------------------------------------------------------------------

create table if not exists public.judges (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  photo_path   text,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists judges_activity_idx on public.judges (activity_id, position);

-- Access codes live apart from judges so the public role can never read them.
create table if not exists public.judge_access (
  judge_id  uuid primary key references public.judges (id) on delete cascade,
  code      text not null unique
);

-- Entries ------------------------------------------------------------------

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists entries_activity_idx on public.entries (activity_id, position);

-- Settings added after the first release (also in supabase/migrations/).
alter table public.activities add column if not exists show_rank boolean not null default true;
-- The entry currently on the LED wall output; null shows only the green screen.
alter table public.activities add column if not exists led_entry_id uuid references public.entries (id) on delete set null;

-- Scores -------------------------------------------------------------------

create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  entry_id     uuid not null references public.entries (id) on delete cascade,
  judge_id     uuid not null references public.judges (id) on delete cascade,
  value        numeric(7, 2) not null,
  created_at   timestamptz not null default now(),
  unique (entry_id, judge_id)
);
create index if not exists scores_activity_idx on public.scores (activity_id);

-- Validate every new score against its activity, whoever inserts it.
create or replace function public.check_score()
returns trigger
language plpgsql
as $$
declare
  a public.activities%rowtype;
begin
  select * into a from public.activities where id = new.activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;
  if not exists (select 1 from public.entries where id = new.entry_id and activity_id = new.activity_id) then
    raise exception 'Entry does not belong to this activity';
  end if;
  if not exists (select 1 from public.judges where id = new.judge_id and activity_id = new.activity_id) then
    raise exception 'Judge does not belong to this activity';
  end if;
  if new.value < a.min_score or new.value > a.max_score then
    raise exception 'Score % is outside % to %', new.value, a.min_score, a.max_score;
  end if;
  if new.value <> round(new.value, a.decimals) then
    raise exception 'Score % has more than % decimal places', new.value, a.decimals;
  end if;
  return new;
end;
$$;

drop trigger if exists scores_check on public.scores;
create trigger scores_check
  before insert on public.scores
  for each row execute function public.check_score();

-- Submitted scores are final. Deleting (developer reset) is still allowed.
create or replace function public.forbid_score_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Submitted scores cannot be changed';
end;
$$;

drop trigger if exists scores_final on public.scores;
create trigger scores_final
  before update on public.scores
  for each row execute function public.forbid_score_update();

-- Row level security ---------------------------------------------------------
-- Public read for the live board; no public writes. judge_access has no
-- policies at all, so only the secret key can touch it.

alter table public.activities   enable row level security;
alter table public.judges       enable row level security;
alter table public.judge_access enable row level security;
alter table public.entries      enable row level security;
alter table public.scores       enable row level security;

drop policy if exists "Public read" on public.activities;
create policy "Public read" on public.activities for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.judges;
create policy "Public read" on public.judges for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.entries;
create policy "Public read" on public.entries for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.scores;
create policy "Public read" on public.scores for select to anon, authenticated using (true);

-- Realtime -------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'judges', 'entries', 'scores'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Judge photos -----------------------------------------------------------------
-- A public bucket: anyone can view a photo by URL; only the server uploads.

insert into storage.buckets (id, name, public)
values ('judge-photos', 'judge-photos', true)
on conflict (id) do nothing;
