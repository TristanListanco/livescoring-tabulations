import { createHash } from "node:crypto";
import type { Board } from "./types";

/**
 * A fingerprint of the results: the activity, its rules, judges, entries and every score.
 * The same results always give the same ID, and changing any score changes it, so a printed
 * sheet can be checked against the system. Format: LS-XXXX-XXXX-XXXX.
 */
export function reportId(board: Board): string {
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify({
    activity: board.activity.id,
    rules: [board.activity.min, board.activity.max, board.activity.decimals],
    judges: byId(board.judges).map((j) => [j.id, j.name]),
    entries: byId(board.entries).map((e) => [e.id, e.name]),
    scores: board.scores
      .map((s) => [s.entryId, s.judgeId, s.value.toFixed(2)])
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
  });
  const hex = createHash("sha256").update(canonical).digest("hex").slice(0, 12).toUpperCase();
  return `LS-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
