"use client";

import { useEffect, useRef, useState } from "react";
import { clock, timerPhase } from "@/lib/pageant";

export type TimerState = ReturnType<typeof timerPhase>;

/** Ignore a clock difference this large: the page was rendered long ago (restored from the cache), not a skewed clock. */
const MAX_SKEW_MS = 10 * 60_000;

/**
 * Where a pageant's scoring timer stands, ticking four times a second while it runs. The server decides when
 * scoring closes, so the countdown follows the server's clock: `serverNow` is when the page was rendered there.
 * Null when no timer runs, and until the first tick, so the server render and the first client render agree.
 */
export function useScoringTimer(closesAt: string | null, timerSeconds: number | null, serverNow: number): TimerState | null {
  const [now, setNow] = useState<number | null>(null);
  const offset = useRef(0);
  useEffect(() => {
    const skew = serverNow - Date.now();
    offset.current = Math.abs(skew) < MAX_SKEW_MS ? skew : 0;
  }, [serverNow]);

  const active = closesAt !== null && timerSeconds !== null;
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now() + offset.current);
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, closesAt]);

  return active && now !== null ? timerPhase(closesAt, now, timerSeconds) : null;
}

const TONE = { open: "bg-go", closing: "bg-caution", closed: "bg-stop" } as const;
const LABEL = { open: "Scoring open", closing: "Closing soon", closed: "Scoring closed" } as const;

type TimerBarProps = {
  state: TimerState;
  timerSeconds: number;
  /** Under "Closing soon" and "Scoring closed": what to do now. */
  closingHint?: string;
  closedHint?: string;
  compact?: boolean;
  /**
   * On a judge's screen, which takes the timer's colour itself (see .judge-screen): the bar is in that colour's deep
   * ink, with a dot and the time left draining in the colour, so it still stands out from the screen around it.
   */
  onColour?: boolean;
};

/**
 * The timer as a coloured bar: green "Scoring open", yellow "Closing soon", red "Scoring closed", with the time
 * left. Navy text on all three, so it reads on the navy screens and in daylight alike.
 */
export function TimerBar({ state, timerSeconds, closingHint, closedHint, compact = false, onColour = false }: TimerBarProps) {
  const hint = state.phase === "closed" ? closedHint : state.phase === "closing" ? closingHint : undefined;
  const share = Math.min(1, state.secondsLeft / timerSeconds);
  const running = state.phase !== "closed";
  // Compact on a judge's screen (criteria, where the bar stays at the top while they scroll) is still read at a glance.
  const size = compact
    ? onColour
      ? { box: "px-4 py-2", label: "text-base", hint: "text-xs", clock: "text-2xl" }
      : { box: "px-3 py-1.5", label: "text-sm", hint: "text-xs", clock: "text-lg" }
    : { box: "px-4 py-3", label: "text-lg", hint: "text-sm", clock: "text-3xl" };
  return (
    <div
      className={`relative overflow-hidden rounded-xl ${
        // On the colour, mint is its ink and prussian white (see .judge-screen): an ink bar with white words.
        onColour ? "navy bg-mint text-prussian" : `text-prussian ${TONE[state.phase]}`
      } ${size.box}`}
    >
      <div className="flex items-center gap-3">
        {/* Announced when the phase changes; the ticking clock beside it isn't. */}
        <span role="status" className={`min-w-0 flex-1 font-bold ${size.label}`}>
          {/* On the colour, the words are white (the screen already says which colour), with a dot of it. */}
          {onColour && <span aria-hidden className={`mr-2 inline-block size-2.5 -translate-y-px rounded-full ${TONE[state.phase]}`} />}
          {LABEL[state.phase]}
          {hint && <span className={`block font-semibold ${size.hint} ${onColour ? "text-prussian/85" : ""}`}>{hint}</span>}
        </span>
        {running && (
          <span className={`tabular shrink-0 font-bold ${size.clock}`}>
            <span className="sr-only">Time left </span>
            {clock(state.secondsLeft)}
            {/* What the number is, on a judge's screen: the time left to score this entry. */}
            {onColour && (
              <span aria-hidden className="ml-1.5 text-sm font-semibold text-prussian/70">
                left
              </span>
            )}
          </span>
        )}
      </div>
      {/* The time left as a bar draining from the right. */}
      {running && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-prussian/15">
          <span
            className={`block h-full transition-[width] duration-300 ease-linear ${onColour ? TONE[state.phase] : "bg-prussian/60"}`}
            style={{ width: `${share * 100}%` }}
          />
        </span>
      )}
    </div>
  );
}
