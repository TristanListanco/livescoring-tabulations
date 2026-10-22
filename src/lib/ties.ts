import type { RankedRow } from "./scoring";
import type { TieBreak } from "./types";

/**
 * Ties in an event without live scoring. Equal averages share a rank, and in the deliberation every tie is broken
 * before the judges sign: the chair of the board of judges puts the tied entries in order and says why. The scores stay
 * as given. A break holds while exactly those entries are tied: a corrected score that changes who's tied asks for a
 * new one.
 */

/** Entries sharing a rank: their place, and the entries in the ranking's own order (by number). */
export type Tie = { rank: number; key: string; entryIds: string[] };

/** A tie's identity: its entries as a set, whatever order they're in. */
export const tieKey = (entryIds: readonly string[]): string => [...entryIds].sort().join(",");

/** The ties in a ranking, highest place first. Unranked entries (no scores) are never tied. */
export function tiesIn(rows: RankedRow[]): Tie[] {
  const byRank = new Map<number, string[]>();
  for (const row of rows) {
    if (row.rank === null) continue;
    byRank.set(row.rank, [...(byRank.get(row.rank) ?? []), row.entry.id]);
  }
  return [...byRank.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort(([a], [b]) => a - b)
    .map(([rank, entryIds]) => ({ rank, key: tieKey(entryIds), entryIds }));
}

/** The break for a tie, if the chair has broken exactly this one. */
export function breakFor(tie: Pick<Tie, "key">, breaks: readonly TieBreak[]): TieBreak | undefined {
  return breaks.find((b) => b.tieKey === tie.key);
}

/** The ties no break settles yet. */
export function unbrokenTies(rows: RankedRow[], breaks: readonly TieBreak[]): Tie[] {
  return tiesIn(rows).filter((tie) => !breakFor(tie, breaks));
}

/**
 * The ranking with each broken tie in the chair's order, each entry with a place of its own (1, 2, 3 where it was
 * 1, 1, 3). A tie not broken yet still shares its rank. The rows are copies: the ranking passed in isn't changed.
 */
export function applyTieBreaks(rows: RankedRow[], breaks: readonly TieBreak[]): RankedRow[] {
  const out = rows.map((row) => ({ ...row }));
  for (const tie of tiesIn(rows)) {
    const settled = breakFor(tie, breaks);
    if (!settled) continue;
    const order = settled.entryIds;
    const at = out.findIndex((row) => row.rank === tie.rank);
    const group = out.slice(at, at + tie.entryIds.length).sort((a, b) => order.indexOf(a.entry.id) - order.indexOf(b.entry.id));
    group.forEach((row, i) => {
      row.rank = tie.rank + i;
      out[at + i] = row;
    });
  }
  return out;
}

/** "1st", "2nd", "3rd", "4th"… for a tie's place. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
