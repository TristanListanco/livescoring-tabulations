"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { reportProblem } from "@/lib/report-problem";
import { timeoutSignal } from "@/lib/timeout-signal";

/** How the server answers an action it doesn't have (Next.js): the page is from an older deployment. */
const ACTION_NOT_FOUND = "x-nextjs-action-not-found";
const RELOADED_AT = "livescoring:reloaded-for-update";
/**
 * The longest an action may take before it's given up. A request on a stalled connection otherwise never ends, and
 * Next.js runs a page's actions one at a time, so every action after it (a judge's next score) would wait behind it.
 * Generous, since creating a pageant with photos takes a while; a judge's score resends sooner (see ScoringPanel).
 */
export const ACTION_TIMEOUT_MS = 25_000;
/** Waits before asking again for a page refresh the server failed: doubling, up to this. */
const MAX_REFRESH_WAIT_MS = 15_000;

/** Wait this long, or until the device is back online, whichever comes first. */
const waitToRetry = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });

/**
 * Every request the page makes to its own server (actions, and the refreshes that keep a screen up to date) goes
 * through here, so a failing server or connection never costs a screen more than a wait.
 *
 * An action that doesn't answer within ACTION_TIMEOUT_MS fails, so the screen says it didn't go through, and what's
 * queued behind it goes ahead.
 *
 * A refresh that doesn't get through (no network) or that the server fails (it's down, or timing out: a 5xx) is asked
 * for again, waiting longer each time, and at once when the device comes back online, until it answers. Next.js would
 * otherwise reload the whole page, into the same failure, and leave the browser's error page, which never comes back by
 * itself. Meanwhile the screen keeps what it last showed, with a note that it's trying again (not on the LED wall,
 * which is on air). A refresh only reads, so asking again is safe. An action isn't sent again here: one that reached
 * the server before the connection dropped would happen twice (a judge's score, which the server recognises, is sent
 * again by the scoring screen).
 *
 * A page left open across a deploy: its buttons reach the server through ids from the version it was loaded with,
 * and every deploy changes them, so afterwards each one fails ("action not found"). Without this, a judge would read
 * "check your connection" and keep retrying a score that can never save, and a form would fail with an error page.
 * Instead the page says LiveScoring was updated and reloads into the new version: the action never ran, so all that's
 * lost is what was being typed. It reloads once; a page still out of date straight after asks to be reloaded rather
 * than reloading again.
 */
export function RequestGuard() {
  const [deploy, setDeploy] = useState<"current" | "reloading" | "stale">("current");
  const [retrying, setRetrying] = useState(false);
  const onAir = usePathname().startsWith("/led/");

  useEffect(() => {
    const original = window.fetch;
    let reloading = false;
    let failingRefreshes = 0;

    /** A refresh, asked for again while the server fails it. */
    const refreshUntilAnswered = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let counted = false;
      try {
        for (let attempt = 0; ; attempt++) {
          let response: Response | null = null;
          try {
            response = await original(input, init);
          } catch (error) {
            // Cancelled (a newer refresh took over): that's not a failure to retry.
            if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
          }
          if (response && (response.status < 500 || init?.signal?.aborted)) return response;
          void response?.body?.cancel();
          if (!counted) {
            counted = true;
            if (failingRefreshes++ === 0) setRetrying(true);
          }
          await waitToRetry(Math.min(1_000 * 2 ** attempt, MAX_REFRESH_WAIT_MS) * (0.8 + Math.random() * 0.4));
          if (init?.signal?.aborted) throw new DOMException("The refresh was superseded.", "AbortError");
        }
      } finally {
        // Answered, or cancelled (a newer refresh took over): either way, no longer waiting here.
        if (counted && --failingRefreshes === 0) setRetrying(false);
      }
    };

    window.fetch = async (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.has("rsc") && !headers.has("next-router-prefetch")) return refreshUntilAnswered(input, init);
      const action = headers.has("next-action");
      const response = await original(input, action ? { ...init, signal: timeoutSignal(ACTION_TIMEOUT_MS, init?.signal) } : init);
      if (response.headers.get(ACTION_NOT_FOUND) !== "1") return response;
      if (!reloading) reportProblem("out_of_date");
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOADED_AT)) || 0;
      } catch {}
      if (Date.now() - last < 30_000) {
        setDeploy("stale");
      } else if (!reloading) {
        reloading = true;
        setDeploy("reloading");
        try {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()));
        } catch {}
        // Long enough to read why the screen is about to reload.
        setTimeout(() => window.location.reload(), 1500);
      }
      // The action never ran. Left waiting, it fails nothing on the page (no error screen) while the page reloads.
      return new Promise<Response>(() => {});
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  if (deploy !== "current") {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-50 bg-prussian px-4 py-3 text-center text-sm font-semibold text-mint shadow-lg">
        {deploy === "reloading" ? "LiveScoring was just updated. Reloading…" : "LiveScoring was just updated. Reload this page to carry on."}
      </div>
    );
  }
  if (retrying && !onAir) {
    return (
      <div role="status" className="fixed inset-x-0 bottom-0 z-50 bg-prussian/95 px-4 py-2.5 text-center text-sm font-semibold text-mint shadow-lg">
        Can&apos;t reach LiveScoring right now. Showing the last update; trying again…
      </div>
    );
  }
  return null;
}
