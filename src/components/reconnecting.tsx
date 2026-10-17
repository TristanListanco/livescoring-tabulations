"use client";

import { useEffect, useRef, useState } from "react";
import { reportProblem } from "@/lib/report-problem";

/** Waits between tries: quick at first, then every half minute, each a little random so screens don't retry in step. */
const DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * For a screen that's on during the show (a judge's, the live results, the LED wall) whose page failed to load: the
 * server or its database didn't answer. It tries again by itself, sooner when the device comes back online, until the
 * page loads, so a blip never leaves the screen dead until someone reloads it. Returns how many tries have failed.
 */
export function useAutoRetry(retry: () => void, error: Error & { digest?: string }): number {
  const failed = useRef(0);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (failed.current === 0) reportProblem("screen_error", error.digest);
    const attempt = failed.current;
    const again = () => {
      failed.current = attempt + 1;
      setTries(attempt + 1);
      retry();
    };
    const delay = DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)] * (0.8 + Math.random() * 0.4);
    const timer = setTimeout(again, delay);
    const online = () => {
      clearTimeout(timer);
      again();
    };
    window.addEventListener("online", online);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, [error, retry]);

  return tries;
}
