import { createHash } from "node:crypto";
import type { Board } from "./types";

/**
 * A fingerprint of the results: the activity, its rules, judges, entries and every score.
 * The same results always give the same ID, and changing any score changes it, so a printed
 * sheet can be checked against the system. Format: LS-XXXX-XXXX-XXXX. A pageant's sheets add a `scope` (the
 * sub-activity, cut or segment), so two sheets with the same scores still get different IDs.
 */
export function reportId(board: Board, scope?: string): string {
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify({
    activity: board.activity.id,
    // Result decimals decide ties, so they count, but only when changed: sheets printed before stay valid.
    rules: [
      board.activity.min,
      board.activity.max,
      board.activity.decimals,
      ...(board.activity.resultDecimals === 2 ? [] : [board.activity.resultDecimals]),
    ],
    judges: byId(board.judges).map((j) => [j.id, j.name]),
    entries: byId(board.entries).map((e) => [e.id, e.name]),
    scores: board.scores
      .map((s) => [s.entryId, s.judgeId, s.value.toFixed(2), ...(s.roundId ? [s.roundId] : [])])
      .sort((a, b) => (a[0] + a[1] + (a[3] ?? "")).localeCompare(b[0] + b[1] + (b[3] ?? ""))),
    // A pageant's sheets: which sub-activity, cut or segment the sheet is for. Event sheets have none, so their IDs stay the same.
    ...(scope ? { scope } : {}),
  });
  const hex = createHash("sha256").update(canonical).digest("hex").slice(0, 12).toUpperCase();
  return `LS-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
