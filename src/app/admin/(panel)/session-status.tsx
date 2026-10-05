import type { SessionState } from "@/lib/types";

export const SESSION_LABEL: Record<SessionState, string> = { draft: "Not started", live: "Live", ended: "Ended" };

/**
 * The session's state as a dot: hollow before judging, tally-light red while live (like a camera on air),
 * grey once it has ended. `pulse` is for the one place on a screen that should draw the eye.
 */
export function SessionDot({ state, pulse = false }: { state: SessionState; pulse?: boolean }) {
  if (state === "live") {
    return (
      <span aria-hidden className="relative flex size-2.5 shrink-0">
        {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-tally opacity-60 motion-reduce:hidden" />}
        <span className="relative inline-flex size-2.5 rounded-full bg-tally" />
      </span>
    );
  }
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${state === "ended" ? "bg-prussian/40" : "border-2 border-field"}`} />;
}

export function SessionStatus({ state, pulse, className = "" }: { state: SessionState; pulse?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SessionDot state={state} pulse={pulse} />
      {SESSION_LABEL[state]}
    </span>
  );
}
