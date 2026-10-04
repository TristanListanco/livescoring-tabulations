import type { Activity, Entry } from "./types";

/**
 * What a judge's screen shows. The organizer drives judging: judges never pick entries themselves.
 * not-started / ended: no keypad. waiting: live, but no entry shown yet. scoring: the current entry,
 * not yet scored. scored: they've submitted the current entry and wait for the organizer's next one.
 */
export type JudgeView =
  | { kind: "not-started" }
  | { kind: "ended" }
  | { kind: "waiting" }
  | { kind: "scoring"; entry: Entry; number: number }
  | { kind: "scored"; entry: Entry; number: number; value: number };

export function judgeView(activity: Pick<Activity, "sessionState" | "currentEntryId">, entries: Entry[], myScores: Map<string, number>): JudgeView {
  if (activity.sessionState === "draft") return { kind: "not-started" };
  if (activity.sessionState === "ended") return { kind: "ended" };
  const index = entries.findIndex((e) => e.id === activity.currentEntryId);
  if (index < 0) return { kind: "waiting" };
  const entry = entries[index];
  const value = myScores.get(entry.id);
  return value === undefined ? { kind: "scoring", entry, number: index + 1 } : { kind: "scored", entry, number: index + 1, value };
}
