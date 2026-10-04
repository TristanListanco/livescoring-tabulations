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
