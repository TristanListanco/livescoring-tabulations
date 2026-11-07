import { rankEntries, shownDivisor, type DisplayRules, type RankedRow } from "./scoring";
import type { Board, TieBreak } from "./types";

/**
 * Ties in an event without live scoring. Equal averages (as shown, to the results' decimal places) share a rank, and in
 * the deliberation every tie is broken before the judges sign, by a judge correcting their score for one of the tied
 * entries, saying why. Activities deliberated before that kept the chair's order instead (tie_breaks): it still holds
 * for them while exactly those entries are tied, and their results print it.
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

/** The chair's order for a tie, if they put exactly this one in order (before ties were broken by corrected scores). */
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

/**
 * The smallest change to one judge's score that always moves the average shown: every judge's score counts towards it,
 * and it's shown to the results' decimal places (criteria scaled to 10 divide it by ten). In the units judges score in.
 * Null when any change they can type does it (whole numbers, say), so there's nothing to say.
 */
export function tieStep(rules: DisplayRules, judgeCount: number): number | null {
  if (judgeCount < 1) return null;
  const step = Number((judgeCount * shownDivisor(rules) * 10 ** -rules.resultDecimals).toFixed(6));
  return step > 10 ** -rules.decimals ? step : null;
}

/** A tie a correction ends: the place the entries shared, and the entries (by number). */
export type BrokenTie = { place: number; entryIds: string[] };

/**
 * The tie a judge's corrected score ends, if it does: the one the entry was in, gone once its score is `value`. Null
 * when the entry wasn't tied, or still is (the averages shown are level all the same).
 */
export function tieBrokenBy(board: Pick<Board, "entries" | "judges" | "scores" | "activity">, judgeId: string, entryId: string, value: number): BrokenTie | null {
  const before = tiesIn(rankEntries(board.entries, board.judges, board.scores, board.activity)).find((t) => t.entryIds.includes(entryId));
  if (!before) return null;
  const scores = board.scores.map((s) => (s.judgeId === judgeId && s.entryId === entryId ? { ...s, value } : s));
  const after = tiesIn(rankEntries(board.entries, board.judges, scores, board.activity));
  return after.some((t) => t.key === before.key) ? null : { place: before.rank, entryIds: before.entryIds };
}

/** "1st", "2nd", "3rd", "4th"… for a tie's place. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
