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
/**
 * The quiet look, for the operator's navy desk in a dim venue: the deep shades the judges' screens take (see
 * .judge-screen) with mint text, the bright colour kept for the draining bar. Once scoring has closed it turns bright,
 * since then the operator has something to do.
 */
const QUIET = { open: "bg-[oklch(0.33_0.07_155)] text-mint", closing: "bg-[oklch(0.38_0.075_70)] text-mint", closed: "bg-stop text-prussian" } as const;
const LABEL = { open: "Scoring open", closing: "Closing soon", closed: "Scoring closed" } as const;

type TimerBarProps = {
  state: TimerState;
  timerSeconds: number;
  /** Under "Closing soon" and "Scoring closed": what to do now. */
  closingHint?: string;
  closedHint?: string;
  compact?: boolean;
  /**
   * On a judge's screen, which takes a deep shade of the timer's colour (see .judge-screen): the bar is the one bright
   * thing on it, larger when compact, with the time left said to be left.
   */
  onColour?: boolean;
  /** On the operator's desk: see QUIET. */
  quiet?: boolean;
};

/**
 * The timer as a coloured bar: green "Scoring open", yellow "Closing soon", red "Scoring closed", with the time
 * left. Navy text on all three, so it reads on the navy screens and in daylight alike.
 */
export function TimerBar({ state, timerSeconds, closingHint, closedHint, compact = false, onColour = false, quiet = false }: TimerBarProps) {
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
    <div className={`relative overflow-hidden rounded-xl ${quiet ? QUIET[state.phase] : `text-prussian ${TONE[state.phase]}`} ${size.box}`}>
      <div className="flex items-center gap-3">
        {/* Announced when the phase changes; the ticking clock beside it isn't. */}
        <span role="status" className={`min-w-0 flex-1 font-bold ${size.label}`}>
          {LABEL[state.phase]}
          {hint && <span className={`block font-semibold ${size.hint}`}>{hint}</span>}
        </span>
        {running && (
          <span className={`tabular shrink-0 font-bold ${size.clock}`}>
            <span className="sr-only">Time left </span>
            {clock(state.secondsLeft)}
            {/* What the number is, on a judge's screen: the time left to score this entry. */}
            {onColour && (
              <span aria-hidden className="ml-1.5 text-sm font-semibold">
                left
              </span>
            )}
          </span>
        )}
      </div>
      {/* The time left as a bar draining from the right. */}
      {running && (
        <span aria-hidden className={`absolute inset-x-0 bottom-0 ${quiet ? "h-1.5 bg-mint/15" : "h-1 bg-prussian/15"}`}>
          <span
            className={`block h-full transition-[width] duration-300 ease-linear ${quiet ? TONE[state.phase] : "bg-prussian/60"}`}
            style={{ width: `${share * 100}%` }}
          />
        </span>
      )}
    </div>
  );
}
