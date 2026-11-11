import { runningSegment } from "@/lib/lifecycle";
import { segmentLabel } from "@/lib/pageant-setup";
import type { Activity, SessionState } from "@/lib/types";

export const SESSION_LABEL: Record<SessionState, string> = { draft: "Not started", live: "Live", deliberation: "Deliberation", ended: "Ended" };

/**
 * A live session's name: "Live" when its scores go out as they come in (live scoring, or a pageant), "Judging" for an
 * event without live scoring, whose scores stay with the judges until they've deliberated.
 */
export const sessionLabel = (state: SessionState, onAir = true) => (state === "live" && !onAir ? "Judging" : SESSION_LABEL[state]);

/**
 * The session's state as a dot: hollow before judging, tally-light red while live (like a camera on air), teal while
 * judging without live scoring (on, but off air), the accent while the judges deliberate, grey once it has ended.
 * `pulse` is for the one place on a screen that should draw the eye. `onAir`: false for an event without live scoring.
 */
export function SessionDot({ state, pulse = false, onAir = true }: { state: SessionState; pulse?: boolean; onAir?: boolean }) {
  if (state === "live") {
    const colour = onAir ? "bg-tally" : "bg-judging";
    return (
      <span aria-hidden className="relative flex size-2.5 shrink-0">
        {pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${colour}`} />}
        <span className={`relative inline-flex size-2.5 rounded-full ${colour}`} />
      </span>
    );
  }
  const look = state === "ended" ? "bg-prussian/40" : state === "deliberation" ? "bg-regal" : "border-2 border-field";
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${look}`} />;
}

/** A live pageant's segment, said after "Live": the one being judged, or that it's between the two. Null otherwise. */
export function segmentStatus(activity: Pick<Activity, "kind" | "sessionState" | "preliminaryEndedAt" | "properStartedAt">): string | null {
  if (activity.kind !== "pageant" || activity.sessionState !== "live") return null;
  const segment = runningSegment(activity);
  return segment ? segmentLabel(segment) : "Between segments";
}

export function SessionStatus({
  state,
  pulse,
  onAir = true,
  segment = null,
  className = "",
}: {
  state: SessionState;
  pulse?: boolean;
  onAir?: boolean;
  /** A live pageant's segment (see segmentStatus). */
  segment?: string | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SessionDot state={state} pulse={pulse} onAir={onAir} />
      {sessionLabel(state, onAir)}
      {segment && ` · ${segment}`}
    </span>
  );
}
