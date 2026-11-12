import { editable, segmentPhase } from "./lifecycle";
import { roundAtOwnPace, roundDeliberating, roundPool, SCORE_UNDO_MS } from "./pageant";
import type { Activity, Board, Entry, Judge, JudgeDevice } from "./types";

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

/**
 * Whether judges score at their own pace: an event without live scoring whose organizer chose it, or a pageant board
 * narrowed to a sub-activity that is judged so (see showingBoard and roundAtOwnPace; a pageant's own row never is).
 * Each judge then scores the entries in any order, without waiting for the next one to be shown; an event's chair still
 * starts the deliberation, a sub-activity's organizer does.
 */
export const atOwnPace = (activity: Pick<Activity, "liveScoring" | "independentScoring">) => !activity.liveScoring && activity.independentScoring;

/**
 * The panel of judges can't change once judging has started, and stays that way after the scores are reset (the
 * session is back to not started, but it started once): the judges who scored are the ones who score again. See the
 * lock table in lifecycle.ts.
 */
export const judgesLocked = (activity: Pick<Activity, "sessionState" | "sessionStartedAt">) => !editable(activity, "judges");

/** Only the organizer moves an event with live scoring between entries: its chair can't, from their screen. */
export const chairMovesEntries = (activity: Pick<Activity, "kind" | "liveScoring">) => !(activity.kind === "event" && activity.liveScoring);

/** How long after judges are moved on that a score for the entry they left still counts: the undo window, and ten seconds for it to arrive. */
export const LATE_SCORE_MS = SCORE_UNDO_MS + 10_000;

/**
 * Whether a judge's score for this entry is accepted now: the entry on screen, or, in an event, the one judges were
 * moved on from in the last LATE_SCORE_MS. A judge confirms a score and has a few seconds to undo it before it's sent;
 * one confirmed just before the organizer (or the chair) moved on still counts. A pageant's scores belong to the
 * sub-activity on screen and its timer, so there only the candidate on screen.
 */
export function scoreWindowOpen(
  activity: Pick<Activity, "kind" | "currentEntryId" | "previousEntryId" | "entryShownAt" | "liveScoring" | "independentScoring">,
  entryId: string,
  now: number,
): boolean {
  // At their own pace, any of the activity's entries (the caller has checked it's one).
  if (activity.currentEntryId === entryId || atOwnPace(activity)) return true;
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
 * An event's scoring timer, in seconds, where it runs: judged an entry at a time, with simple or criteria scoring (not at
 * judges' own pace, where nothing is shown in turn). Null otherwise, or with none set. A pageant's are its sub-activities'.
 */
export const eventTimer = (activity: Pick<Activity, "kind" | "liveScoring" | "independentScoring" | "timerSeconds">) =>
  activity.kind === "event" && !atOwnPace(activity) ? activity.timerSeconds : null;

/**
 * Database columns for showing judges an entry (null: have them wait), or why it can't be shown. In a pageant only
 * a candidate in the sub-activity being judged can be shown, and showing one starts that sub-activity's timer; in an
 * event with a timer (see eventTimer), showing an entry starts it.
 */
export function showColumns(board: Board, entryId: string | null, now: number): { columns: Record<string, string | null> } | { error: string } {
  if (board.activity.kind !== "pageant") {
    const seconds = eventTimer(board.activity);
    // Only an event with a timer writes it, so the rest show entries as they always have.
    return { columns: seconds ? { ...showEntryColumns(entryId), scoring_closes_at: entryId ? new Date(now + seconds * 1000).toISOString() : null } : showEntryColumns(entryId) };
  }
  const round = board.rounds.find((r) => r.id === board.activity.currentRoundId);
  if (!round) return { error: "Choose the sub-activity to judge first." };
  // Its judges are reviewing their scores: nothing is shown to score until it's signed off.
  if (roundDeliberating(round)) return { error: `The judges are deliberating ${round.name}, so no candidate is shown until it's signed off.` };
  // At their own pace each judge picks the candidates: none is shown (having them wait is still fine).
  if (entryId && roundAtOwnPace(round)) return { error: `Judges score ${round.name} at their own pace, so no candidate is shown.` };
  if (entryId && !roundPool(board, round.id).entries.some((e) => e.id === entryId)) {
    return { error: `That candidate isn't in ${round.name}.` };
  }
  const closesAt = entryId && round.timerSeconds ? new Date(now + round.timerSeconds * 1000).toISOString() : null;
  return { columns: { ...showEntryColumns(entryId), scoring_closes_at: closesAt } };
}

/**
 * What can start now that every judge it opens screens for has an approved device: an event's session, a pageant's
 * preliminary (its own board: judges of pageant proper only don't count, as the desk's start doesn't), or pageant proper
 * in the break between the segments (its board). Null otherwise. `count`: how many judges that is. Said on the
 * activity's other tabs, with a button to the Session tab (see JudgesIn).
 */
export function startReady(
  activity: Pick<Activity, "kind" | "sessionState" | "preliminaryEndedAt" | "properStartedAt">,
  judges: Pick<Judge, "id" | "panel">[],
  devices: Pick<JudgeDevice, "judgeId" | "status">[],
): { what: "session" | "preliminary" | "proper"; count: number } | null {
  const ready = (board: Pick<Judge, "id">[]) => board.length > 0 && board.every((j) => devices.some((d) => d.judgeId === j.id && d.status === "approved"));
  if (activity.kind !== "pageant") return activity.sessionState === "draft" && ready(judges) ? { what: "session", count: judges.length } : null;
  if (activity.sessionState === "draft") {
    const board = judges.filter((j) => j.panel !== "proper");
    return ready(board) ? { what: "preliminary", count: board.length } : null;
  }
  if (segmentPhase(activity, "preliminary") === "ended" && segmentPhase(activity, "proper") === "setup") {
    const board = judges.filter((j) => j.panel !== "preliminary");
    return ready(board) ? { what: "proper", count: board.length } : null;
  }
  return null;
}
