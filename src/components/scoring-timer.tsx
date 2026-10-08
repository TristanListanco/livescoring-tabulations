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
 * The timer as a coloured bar: green "Scoring open", yellow "Closing soon", red "Scoring closed", with the time
 * left. Navy text on all three, so it reads on the navy screens and in daylight alike.
 */
export function TimerBar({ state, timerSeconds, closedHint, compact = false }: { state: TimerState; timerSeconds: number; closedHint?: string; compact?: boolean }) {
  const label = state.phase === "open" ? "Scoring open" : state.phase === "closing" ? "Closing soon" : "Scoring closed";
  const share = Math.min(1, state.secondsLeft / timerSeconds);
  return (
    <div className={`relative overflow-hidden rounded-xl text-prussian ${TONE[state.phase]} ${compact ? "px-3 py-1.5" : "px-4 py-3"}`}>
      <div className="flex items-center gap-3">
        {/* Announced when the phase changes; the ticking clock beside it isn't. */}
        <span role="status" className={`min-w-0 flex-1 font-bold ${compact ? "text-sm" : "text-lg"}`}>
          {label}
          {state.phase === "closed" && closedHint && <span className={`block font-semibold ${compact ? "text-xs" : "text-sm"}`}>{closedHint}</span>}
        </span>
        {state.phase !== "closed" && (
          <span className={`tabular font-bold ${compact ? "text-lg" : "text-3xl"}`}>
            <span className="sr-only">Time left </span>
            {clock(state.secondsLeft)}
          </span>
        )}
      </div>
      {/* The time left as a bar draining from the right. */}
      {state.phase !== "closed" && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-prussian/15">
          <span className="block h-full bg-prussian/60 transition-[width] duration-300 ease-linear" style={{ width: `${share * 100}%` }} />
        </span>
      )}
    </div>
  );
}
