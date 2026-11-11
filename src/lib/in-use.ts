import type { SessionState } from "./types";

/** An activity judges are on, and why it holds its organizer: running, or not started with judges' devices in. */
export type InUse = { id: string; name: string; running: boolean };

/**
 * Which of an account's activities judges are on right now, if any: one that's live or deliberating first, then one
 * that hasn't started but has a judge's device approved or waiting (`waitingIds`). Signing out then would leave the
 * show, or the judges waiting for it, without the organizer. Archived activities aren't passed in.
 */
export function activityInUse(activities: { id: string; name: string; sessionState: SessionState }[], waitingIds: ReadonlySet<string>): InUse | null {
  const running = activities.find((a) => a.sessionState === "live" || a.sessionState === "deliberation");
  if (running) return { id: running.id, name: running.name, running: true };
  const waiting = activities.find((a) => a.sessionState === "draft" && waitingIds.has(a.id));
  return waiting ? { id: waiting.id, name: waiting.name, running: false } : null;
}

/** Why an account can't sign out (or be deleted) while an activity is in use, in the panel's words. */
export function inUseMessage(inUse: InUse, doing: string): string {
  return inUse.running
    ? `${inUse.name} is running, so you can't ${doing} now. End its session first.`
    : `Judges are waiting on ${inUse.name}, so you can't ${doing} now. Start or end its session, or sign their devices out first.`;
}
