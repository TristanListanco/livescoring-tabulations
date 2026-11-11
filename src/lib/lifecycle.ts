import type { Activity, Segment } from "./types";

/**
 * An activity's lifecycle, in one place: the phase it's in, the moves between phases, and what can still be changed in
 * each. The database stores the phase across a few columns (session_state, session_started_at, signed_off_at,
 * archived_at); the server actions check moves here before writing, the database's triggers hold the same rules for
 * anything that slips past (see docs/state-machines.md), and the panel asks here what to offer. Pure, so it's tested.
 */

/**
 * Where an activity stands.
 * - setup: not started yet. Everything about it can change.
 * - setup-after-reset: back to not started after its scores were reset. It started once, so the panel of judges and
 *   the scoring rules stay as they were (the same judges score again, by the same rules); the order can change.
 * - live: judges are scoring.
 * - deliberation: every entry is scored (an event without live scoring); judges review, correct and sign.
 * - ended: judging is over. Scores are final; it can be reopened, or (with every score in) archived.
 * - signed-off: ended through the deliberation, signed by every judge and the organizer. Its results are out.
 * - archived: put away for good; only read, exported and deleted.
 */
export type Phase = "setup" | "setup-after-reset" | "live" | "deliberation" | "ended" | "signed-off" | "archived";

type Lifecycle = Pick<Activity, "sessionState" | "sessionStartedAt" | "signedOffAt" | "archivedAt" | "kind" | "preliminaryEndedAt" | "properStartedAt">;

export function phaseOf(activity: Pick<Lifecycle, "sessionState"> & Partial<Lifecycle>): Phase {
  if (activity.archivedAt) return "archived";
  switch (activity.sessionState) {
    case "draft":
      return activity.sessionStartedAt ? "setup-after-reset" : "setup";
    case "live":
      return "live";
    case "deliberation":
      return "deliberation";
    case "ended":
      return activity.signedOffAt ? "signed-off" : "ended";
  }
}

/**
 * The moves between phases, and the phases each starts from. A move's other conditions (judges and entries to start
 * with, every judge's signature to end a deliberation, the password) are the server's to check; this is only whether
 * the move exists from here.
 * - start: the session opens and judges' screens with it.
 * - deliberate: an event without live scoring, every entry scored, goes to the judges' review.
 * - end: judging stops (a deliberation ends once everyone has signed).
 * - reopen: an ended session runs again. Not once it's signed off (deliberate again instead), and not an event with
 *   live scoring that ended with every score in (its scores are final; the server checks that, from the scores).
 * - redeliberate: a signed-off session goes back to the judges, who sign again.
 * - reset: every score goes, and the session is back to not started. Any time until it's archived.
 * - archive: an ended session is put away for good.
 */
export const SESSION_MOVES = {
  start: { from: ["setup", "setup-after-reset"], to: "live" },
  deliberate: { from: ["live"], to: "deliberation" },
  end: { from: ["live", "deliberation"], to: "ended" },
  reopen: { from: ["ended"], to: "live" },
  redeliberate: { from: ["signed-off"], to: "deliberation" },
  reset: { from: ["setup", "setup-after-reset", "live", "deliberation", "ended", "signed-off"], to: "setup-after-reset" },
  archive: { from: ["ended", "signed-off"], to: "archived" },
} as const satisfies Record<string, { from: readonly Phase[]; to: Phase }>;

export type Move = keyof typeof SESSION_MOVES;

export const canMove = (activity: Parameters<typeof phaseOf>[0], move: Move): boolean =>
  (SESSION_MOVES[move].from as readonly Phase[]).includes(phaseOf(activity));

/**
 * Where a pageant's segment stands. The two run in order, each as a session of its own inside the activity's: the
 * preliminary from the start (the activity's start move) until it ends, then pageant proper from its own start to the
 * activity's end. In between, the preliminary's judges are done and pageant proper's haven't started.
 * - setup: not started yet: its program and its own judges can still change.
 * - live: its judges are scoring.
 * - ended: its judges' part is over.
 */
export type SegmentPhase = "setup" | "live" | "ended";

type Segments = Pick<Lifecycle, "sessionState"> & Partial<Pick<Lifecycle, "preliminaryEndedAt" | "properStartedAt">>;

export function segmentPhase(activity: Segments, segment: Segment): SegmentPhase {
  if (activity.sessionState === "draft") return "setup";
  if (activity.sessionState !== "live") return "ended";
  if (segment === "preliminary") return activity.preliminaryEndedAt ? "ended" : "live";
  return activity.properStartedAt ? "live" : "setup";
}

/** The segment a pageant is judging now, or null: before the start, between the two, and once it has ended. */
export function runningSegment(activity: Segments): Segment | null {
  if (segmentPhase(activity, "proper") === "live") return "proper";
  return segmentPhase(activity, "preliminary") === "live" ? "preliminary" : null;
}

/**
 * A pageant's moves between its segments, while its session is live (the activity's own start and end begin the
 * preliminary and end pageant proper):
 * - endPreliminary: the preliminary's judges are done (it takes the password, as ending a session does).
 * - reopenPreliminary: back to the preliminary, until pageant proper starts.
 * - startProper: pageant proper's judges start, once the preliminary has ended.
 */
export type SegmentMove = "endPreliminary" | "reopenPreliminary" | "startProper";

export function canMoveSegment(activity: Segments, move: SegmentMove): boolean {
  const preliminary = segmentPhase(activity, "preliminary");
  if (move === "endPreliminary") return preliminary === "live";
  return preliminary === "ended" && segmentPhase(activity, "proper") === "setup";
}

/**
 * What can still change, by phase. One table instead of the checks each form and action used to make on its own.
 * - judges: who's on the panel (and the chair). Fixed once judging has started, even after a reset.
 * - rules: how judges score: live scoring, the time limit, own pace, decimal places. Fixed like the panel.
 * - order, program, guides: the running order, a pageant's program, the criteria's guides. Until judging starts, and
 *   again after a reset, when nothing has been scored by them.
 * - entries: adding, renaming and removing entries (each action has its own finer rules mid-show). Until judging ends.
 * - judgeOptions: what judges see while they correct and deliberate. Until judging ends.
 */
export type Part = "judges" | "rules" | "order" | "program" | "guides" | "entries" | "judgeOptions";

const EDITABLE: Record<Part, readonly Phase[]> = {
  judges: ["setup"],
  rules: ["setup"],
  order: ["setup", "setup-after-reset"],
  program: ["setup", "setup-after-reset"],
  guides: ["setup", "setup-after-reset"],
  entries: ["setup", "setup-after-reset", "live", "deliberation"],
  judgeOptions: ["setup", "setup-after-reset", "live", "deliberation"],
};

/**
 * Whether a part can change now. `segment`: for a pageant's judges and program, which segment's: pageant proper's own
 * judges and sub-activities can change until pageant proper starts, while the preliminary runs.
 */
export function editable(activity: Parameters<typeof phaseOf>[0], part: Part, segment?: Segment): boolean {
  if (segment === "proper" && (part === "judges" || part === "program") && activity.kind === "pageant" && phaseOf(activity) === "live") {
    return segmentPhase(activity, "proper") === "setup";
  }
  return EDITABLE[part].includes(phaseOf(activity));
}

/**
 * Whether scores go out as they come in (a pageant, or an event with live scoring), rather than staying with the judges
 * until they've deliberated and signed. Such an activity shows "Live" while it runs, and has an LED wall.
 */
export const scoresGoOutLive = (activity: Pick<Activity, "kind" | "liveScoring">) => activity.kind === "pageant" || activity.liveScoring;

/** Whether an activity has an LED wall now: its scores go out live, and it isn't archived (its links close then). */
export const hasLedWall = (activity: Pick<Activity, "kind" | "liveScoring" | "archivedAt">) => scoresGoOutLive(activity) && !activity.archivedAt;

/**
 * A judge's device: pending (signed in with the code, waiting for the organizer), approved (the one that scores),
 * revoked (signed out, denied or replaced; final). Only a waiting device can be approved: a stale request on another
 * screen mustn't sign the judge out of the device they're using.
 */
export type DeviceStatus = "pending" | "approved" | "revoked";
export const canApprove = (status: DeviceStatus) => status === "pending";

/**
 * Why an ended activity's results can't be downloaded, in the archive dialog's words, or null when they can: every score
 * is needed, and without live scoring, everyone's signature from the deliberation (the export says the same). Archiving
 * makes it permanent, so the dialog says so first.
 */
export function archiveBlocked(
  activity: Pick<Activity, "kind" | "liveScoring" | "signedOffAt">,
  progress: { complete: boolean; submitted: number; possible: number },
): string | null {
  if (!progress.complete) return `${progress.possible - progress.submitted} of ${progress.possible} scores are missing`;
  if (activity.kind === "event" && !activity.liveScoring && !activity.signedOffAt) return "the judges and you haven't signed them";
  return null;
}
