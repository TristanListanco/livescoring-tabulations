import type { PostgrestError } from "@supabase/supabase-js";

/** Rows asked for at a time: Supabase's own limit on one read, unless its "Max rows" setting was changed. */
export const PAGE_ROWS = 1000;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: PostgrestError | null; count?: number | null }>;

/**
 * Every row of a read that can be longer than Supabase returns at once. It returns at most "Max rows" (1,000 unless
 * changed) and leaves the rest out without an error: a big pageant's scores would quietly lose some. `page` reads rows
 * `from` to `to` (inclusive) in a fixed order, with an exact count; pages follow until every row the count promised is
 * in, whatever the limit is. Most reads fit in the first page, a single request as before.
 */
export async function readAll<Row>(page: (from: number, to: number) => Page<Row>): Promise<{ data: Row[] | null; error: PostgrestError | null }> {
  const first = await page(0, PAGE_ROWS - 1);
  if (first.error || !first.data) return { data: first.data, error: first.error };
  const rows = [...first.data];
  const total = first.count ?? rows.length;
  while (rows.length < total) {
    const next = await page(rows.length, rows.length + PAGE_ROWS - 1);
    if (next.error) return { data: null, error: next.error };
    // Rows deleted while reading: what's left is all there is.
    if (!next.data?.length) break;
    rows.push(...next.data);
  }
  return { data: rows, error: null };
}
