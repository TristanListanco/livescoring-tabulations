import { roundPool, SCORE_UNDO_MS } from "./pageant";
import type { Activity, Board, Entry } from "./types";

/**
 * What a judge's screen shows. The organizer drives judging: judges never pick entries themselves.
 * not-started / ended: no keypad. waiting: live, but no entry shown yet. scoring: the current entry,
 * not yet scored. scored: they've submitted the current entry and wait for the organizer's next one.
 * deliberation: every entry is scored; they review their scores and sign.
 */
export type JudgeView =
  | { kind: "not-started" }
  | { kind: "ended" }
  | { kind: "deliberation" }
  | { kind: "waiting" }
  | { kind: "scoring"; entry: Entry; number: number }
  | { kind: "scored"; entry: Entry; number: number; value: number };

export function judgeView(activity: Pick<Activity, "sessionState" | "currentEntryId">, entries: Entry[], myScores: Map<string, number>): JudgeView {
  if (activity.sessionState === "draft") return { kind: "not-started" };
  if (activity.sessionState === "ended") return { kind: "ended" };
  if (activity.sessionState === "deliberation") return { kind: "deliberation" };
  const index = entries.findIndex((e) => e.id === activity.currentEntryId);
  if (index < 0) return { kind: "waiting" };
  const entry = entries[index];
  const value = myScores.get(entry.id);
  const number = entry.number ?? index + 1;
  return value === undefined ? { kind: "scoring", entry, number } : { kind: "scored", entry, number, value };
}

/** How long after judges are moved on that a score for the entry they left still counts: the undo window, and ten seconds for it to arrive. */
export const LATE_SCORE_MS = SCORE_UNDO_MS + 10_000;

/**
 * Whether a judge's score for this entry is accepted now: the entry on screen, or, in an event, the one judges were
 * moved on from in the last LATE_SCORE_MS. A judge confirms a score and has a few seconds to undo it before it's sent;
 * one confirmed just before the organizer (or the chair) moved on still counts. A pageant's scores belong to the
 * sub-activity on screen and its timer, so there only the candidate on screen.
 */
export function scoreWindowOpen(
  activity: Pick<Activity, "kind" | "currentEntryId" | "previousEntryId" | "entryShownAt">,
  entryId: string,
  now: number,
): boolean {
  if (activity.currentEntryId === entryId) return true;
  if (activity.kind !== "event" || activity.previousEntryId !== entryId || !activity.entryShownAt) return false;
  const movedOn = Date.parse(activity.entryShownAt);
  return Number.isFinite(movedOn) && now - movedOn <= LATE_SCORE_MS;
}

/** Where the running order stands: the entry on judges' screens, and the ones before and after it. */
export function entryNeighbors(entries: Entry[], currentEntryId: string | null) {
  const index = entries.findIndex((e) => e.id === currentEntryId);
  return {
    index,
    entry: index >= 0 ? entries[index] : null,
    previous: index > 0 ? entries[index - 1] : null,
    // Nothing on screen yet: the first entry is next.
    next: index < 0 ? (entries[0] ?? null) : (entries[index + 1] ?? null),
  };
}

/**
 * Database columns for showing judges an entry. The LED wall follows to the same entry. Sending judges back to
 * waiting (null) leaves the LED wall as it is.
 */
export function showEntryColumns(entryId: string | null): Record<string, string | null> {
  return entryId ? { current_entry_id: entryId, led_entry_id: entryId } : { current_entry_id: null };
}

/**
 * Database columns for showing judges an entry (null: have them wait), or why it can't be shown. In a pageant only
 * a candidate in the sub-activity being judged can be shown, and showing one starts that sub-activity's timer.
 */
export function showColumns(board: Board, entryId: string | null, now: number): { columns: Record<string, string | null> } | { error: string } {
  if (board.activity.kind !== "pageant") return { columns: showEntryColumns(entryId) };
  const round = board.rounds.find((r) => r.id === board.activity.currentRoundId);
  if (!round) return { error: "Choose the sub-activity to judge first." };
  if (entryId && !roundPool(board, round.id).entries.some((e) => e.id === entryId)) {
    return { error: `That candidate isn't in ${round.name}.` };
  }
  const closesAt = entryId && round.timerSeconds ? new Date(now + round.timerSeconds * 1000).toISOString() : null;
  return { columns: { ...showEntryColumns(entryId), scoring_closes_at: closesAt } };
}
