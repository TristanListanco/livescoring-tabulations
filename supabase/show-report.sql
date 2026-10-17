-- How the database did over one show: run in the Supabase SQL editor, a part at a time.
--
-- The database keeps a running total for each kind of query it runs (pg_stat_statements, on in every Supabase
-- project): how often, and how long it took on average, at worst, and how much that varied. Start the totals from zero
-- before the show, and afterwards they cover the show alone. The spread (standard deviation) and worst case are the
-- tail an average hides: a score save averaging 60 ms with a spread of 300 ms sometimes takes seconds.
-- The app's own log has each action's time from the app's side, database waits included (see "Observability" in the
-- README).

-- 1. Before the show (or the rehearsal): start from zero.
select extensions.pg_stat_statements_reset();

-- 2. After it: where the database's time went, most first. "realtime" and "wal" lines are Supabase Realtime telling
-- the screens about changes; "pgrst_source" lines are the app's reads and writes.
select
  round(total_exec_time::numeric) as total_ms,
  round((100 * total_exec_time / nullif(sum(total_exec_time) over (), 0))::numeric, 1) as share_pct,
  calls,
  round(mean_exec_time::numeric, 2) as mean_ms,
  round(stddev_exec_time::numeric, 2) as spread_ms,
  round(max_exec_time::numeric, 1) as worst_ms,
  round(rows::numeric / greatest(calls, 1), 1) as rows_per_call,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from extensions.pg_stat_statements
where calls > 0
order by total_exec_time desc
limit 20;

-- 3. During it: connections in use, of the most the plan allows.
select
  count(*) filter (where state = 'active') as active,
  count(*) as open,
  (select setting::int from pg_settings where name = 'max_connections') as max
from pg_stat_activity;
