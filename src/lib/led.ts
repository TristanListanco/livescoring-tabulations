import { firstNames } from "./names";
import { rankEntries } from "./scoring";
import type { Board, Entry, Judge } from "./types";

/** The green screen overlay is drawn on a fixed 1920×1080 stage and scaled to fit the screen. */
export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** Pure chroma green: the video switcher keys this out. Nothing in the graphic uses it. */
export const KEY_GREEN = "#00ff00";
/** Session storage: which kind of wall this tab last showed ("full" or "key"), for its error screen to match. */
export const LED_MODE = "livescoring:led-mode";

/**
 * waiting: the judge hasn't scored yet. submitted: they have, but scores are held back until
 * every judge is in. shown: the score is visible.
 */
export type TileState = "waiting" | "submitted" | "shown";

export type LedScene =
  | { kind: "empty" }
  | {
      kind: "entry";
      entry: Entry;
      number: number;
      /**
       * label: what the wall calls the judge, their first name (see firstNames); null when the activity keeps
       * judges anonymous, and the wall shows a "?" instead of their name and photo.
       */
      tiles: { judge: Judge; label: string | null; state: TileState; value: number | null }[];
      /** hidden while held back; running while judges are still scoring; final once all have. value: as shown (see rankEntries). */
      average: { state: "none" | "hidden" | "running" | "final"; value: number | null; count: number; total: number };
    };

/**
 * What the LED wall should show right now for the entry the admin put on air. A pageant sub-activity that deliberates
 * (its board's activity isn't live, see showingBoard) shows only that each judge has scored, until it's signed off:
 * from the marks the public board carries instead of scores, or from the scores themselves in the organizer's preview.
 */
export function ledScene(board: Board): LedScene {
  const { activity, judges } = board;
  const row = rankEntries(board.entries, judges, board.scores, activity).find((r) => r.entry.id === activity.ledEntryId);
  if (!row) return { kind: "empty" };

  const held = !activity.liveScoring && !activity.signedOffAt;
  const marked = new Set((board.scored ?? board.scores).filter((s) => s.entryId === row.entry.id).map((s) => s.judgeId));
  const count = held ? judges.filter((j) => marked.has(j.id)).length : row.count;
  const complete = judges.length > 0 && count === judges.length;
  const hold = held || (activity.ledHoldScores && !complete);
  const labels = firstNames(judges);
  const tiles = judges.map((judge) => {
    const label = activity.ledAnonymous ? null : (labels.get(judge.id) ?? judge.name);
    const value = row.scores.get(judge.id);
    if (held) return marked.has(judge.id) ? { judge, label, state: "submitted" as const, value: null } : { judge, label, state: "waiting" as const, value: null };
    if (value === undefined) return { judge, label, state: "waiting" as const, value: null };
    return hold ? { judge, label, state: "submitted" as const, value: null } : { judge, label, state: "shown" as const, value };
  });

  const state = held ? (count === 0 ? "none" : "hidden") : complete ? "final" : hold ? "hidden" : row.count === 0 ? "none" : "running";
  return {
    kind: "entry",
    entry: row.entry,
    number: row.number,
    tiles,
    average: { state, value: state === "final" || state === "running" ? row.average : null, count, total: judges.length },
  };
}
