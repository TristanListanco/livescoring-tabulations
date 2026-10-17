-- Three indexes, each for an operation whose query plan read far more rows than it needed (measured on a copy of the
-- database grown to 3,000 activities and 440,000 scores):
--
-- Deleting an entry deletes its scores and notes, and deleting an activity does that for every entry. Neither table had
-- an index starting with the entry alone (a score's unique indexes each cover only scores with, or without, a
-- sub-activity; a note's key starts with the judge), so each of those deletes read the whole table: an activity's
-- delete took 635 ms, and grew with every score ever saved. With these, 19 ms. Saving a score costs 0.01 ms more.
--
-- The super admin's list of organizers' activities shows the newest 50 at a time, newest first. Without an index in
-- that order, the database counts every activity's judges, entries and scores before it can tell which are the newest
-- (126 ms, and growing); with it, it reads just those 50 (2 ms).
--
-- Run in the Supabase SQL editor after 022. Safe to run again. Writes to each table wait while its index is built,
-- well under a second at this size; run it between shows.
-- On a brand-new database (e.g. the CI stack) this does nothing, and schema.sql creates them.

do $migration$
begin
  if to_regclass('public.scores') is not null then
    create index if not exists scores_entry_idx on public.scores (entry_id);
  end if;
  if to_regclass('public.judge_notes') is not null then
    create index if not exists judge_notes_entry_idx on public.judge_notes (entry_id);
  end if;
  if to_regclass('public.activities') is not null then
    create index if not exists activities_listed_idx on public.activities (created_at desc) where owner_id is not null;
  end if;
end;
$migration$;
