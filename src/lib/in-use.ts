import { canMoveSegment, pausedPageant } from "./lifecycle";
import type { Activity, SessionState } from "./types";

/**
 * An activity judges are on, and why it holds its organizer: running, or not started with judges' devices in.
 * `pausable`: a pageant in the break between its segments, which can be paused to let its organizer go.
 */
export type InUse = { id: string; name: string; running: boolean; pausable?: true };

type Held = { id: string; name: string; sessionState: SessionState } & Partial<Pick<Activity, "kind" | "preliminaryEndedAt" | "properStartedAt" | "pausedAt">>;

/**
 * Which of an account's activities judges are on right now, if any: one that's live or deliberating first, then one
 * that hasn't started but has a judge's device approved or waiting (`waitingIds`). Signing out then would leave the
 * show, or the judges waiting for it, without the organizer. A pageant paused between its segments holds nobody (its
 * judges are signed out), unless `pausedHolds`: its show isn't over, so its organizer can't be deleted. Archived
 * activities aren't passed in.
 */
export function activityInUse(activities: Held[], waitingIds: ReadonlySet<string>, pausedHolds = false): InUse | null {
  const running = activities.find(
    (a) => (a.sessionState === "live" || a.sessionState === "deliberation") && (pausedHolds || !(a.kind === "pageant" && pausedPageant(a))),
  );
  if (running) return { id: running.id, name: running.name, running: true, ...(running.kind === "pageant" && canMoveSegment(running, "pause") ? { pausable: true as const } : {}) };
  const waiting = activities.find((a) => a.sessionState === "draft" && waitingIds.has(a.id));
  return waiting ? { id: waiting.id, name: waiting.name, running: false } : null;
}

/** Why an account can't sign out (or be deleted) while an activity is in use, in the panel's words. */
export function inUseMessage(inUse: InUse, doing: string): string {
  if (inUse.pausable) return `${inUse.name} is between its preliminary and pageant proper, so you can't ${doing} now. Pause it on its Session tab first.`;
  return inUse.running
    ? `${inUse.name} is running, so you can't ${doing} now. End its session first.`
    : `Judges are waiting on ${inUse.name}, so you can't ${doing} now. Start or end its session, or sign their devices out first.`;
}
