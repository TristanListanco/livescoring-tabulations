-- Which correction broke a tie.
--
-- score_corrections.broke_tie: in an event's deliberation every tie in the ranking is broken before the judges sign, by a
-- judge correcting their score for one of the tied entries, saying why (the chair no longer puts tied entries in order).
-- A correction that ends a tie keeps which one: { "place": 1, "entryIds": ["…", "…"] }, the place the entries shared and
-- the entries. The results PDF says so beside the correction. Null for every other correction.
--
-- Run in the Supabase SQL editor after 035, or let the release pipeline run it. Safe to run again. Additive: until it's
-- run, corrections still break ties, and the PDF just doesn't say which did. On a brand-new database this does nothing,
-- and schema.sql creates it.

do $migration$
begin
  if to_regclass('public.score_corrections') is null then
    return;
  end if;

  alter table public.score_corrections add column if not exists broke_tie jsonb;
end;
$migration$;
