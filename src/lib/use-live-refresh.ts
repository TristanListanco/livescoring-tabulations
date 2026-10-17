"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRefresher } from "./refresh-schedule";
import { reportProblem } from "./report-problem";
import { timeoutSignal } from "./timeout-signal";
import { browserClient } from "./supabase/browser";

/**
 * live: keeping up (realtime connected, or the page's checks are answering). polling: realtime unavailable (blocked or
 * flaky Wi-Fi), so the page checks on a timer instead. offline: the device has no network at all.
 */
export type LiveStatus = "connecting" | "live" | "polling" | "offline";

const CONNECT_GRACE_MS = 8_000;
/** A check still unanswered after this is given up on: the next one is the retry. */
const CHECK_TIMEOUT_MS = 8_000;
/** While checks keep failing, the gap between them doubles, up to this. */
const MAX_BACKOFF_MS = 30_000;

type Options = {
  /** How often the page checks whether its activity changed (a judge waiting for approval checks more often). */
  pollMs?: number;
  /** At most one refresh this often: for a page many people watch at once (the public live results). */
  minGapMs?: number;
  /**
   * Hear changes over realtime as well as checking. Off for the audience's pages: with many activities at once their
   * phones would be most of realtime's connections, and realtime falls behind when every change has to reach hundreds
   * of them. Their checks keep them a few seconds behind at most, and cost a single row each.
   */
  realtime?: boolean;
};

/**
 * Re-render the current page whenever this activity's data changes.
 *
 * Every few seconds the page reads its activity's last change (activity_changes: one row, kept up to date by database
 * triggers on its settings, judges, entries, scores and program) straight from the database, and refreshes only when
 * it moved: a check costs no page render, and a missed notice or a dropped connection costs seconds, not a stale
 * screen. Realtime makes it sooner: a notice of a change refreshes at once. Refreshing whenever the page comes back
 * into view covers a phone's browser sitting in the background (for example while the camera scans a QR code).
 * Changes arriving together make one refresh (see createRefresher).
 *
 * The page never learns what changed: the results tables are private, so it reloads its data from the server. Before
 * migration 016 there's no activity_changes: realtime reports an error, and the checks fall back to refreshing.
 *
 * It only reloads once a check has just reached the server. A reload that can't reach it (the venue Wi-Fi dropped)
 * would leave the screen on an error page that never comes back by itself; instead it waits, checking less often the
 * longer checks fail (with a little randomness, so a room of screens doesn't retry in step), and catches up as soon
 * as one gets through.
 */
export function useLiveRefresh(activityId: string, { pollMs = 5_000, minGapMs = 0, realtime = true }: Options = {}): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    let stopped = false;
    let subscribed = false;
    // The last change this page knows about: undefined until the first check, then the row's time (null: none yet).
    let seen: string | null | undefined;
    const refresher = createRefresher(() => router.refresh(), { minGapMs });
    const refresh = refresher.request;
    const supabase = browserClient();

    // Checks that failed in a row: the gap to the next one grows with them.
    let failures = 0;
    /** Check for a change, and reload if there was one (or, with `catchUp`, anyway). False: the server wasn't reached. */
    const check = async (catchUp = false): Promise<boolean> => {
      const { data, error } = await supabase
        .from("activity_changes")
        .select("changed_at")
        .eq("activity_id", activityId)
        .abortSignal(timeoutSignal(CHECK_TIMEOUT_MS))
        // The next check is the retry; retrying this one as well would only add to the load on a struggling server.
        .retry(false)
        .maybeSingle();
      if (stopped) return false;
      if (error) {
        // The server answered that it can't read it (before migration 016): reloading is the fallback, and safe.
        const answered = typeof error.code === "string" && error.code.length > 0;
        if (answered) failures = 0;
        else failures++;
        if (!subscribed) {
          setStatus(navigator.onLine ? "polling" : "offline");
          if (answered) refresh();
        }
        return answered;
      }
      failures = 0;
      const at = (data as { changed_at: string } | null)?.changed_at ?? null;
      // The first check can't tell whether a change came between the server rendering this page and now (the time it
      // took to load and start up), so it catches up once; after that, only a change does.
      if (catchUp || seen === undefined || at !== seen) refresh();
      seen = at;
      if (!realtime) setStatus("live");
      return true;
    };
    // Not while the page is hidden (a phone locked in a pocket, a tab in the background): it refreshes as it comes back
    // into view anyway, and a crowd of idle phones would otherwise keep the database busy for nothing.
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleCheck = () => {
      clearTimeout(checkTimer);
      const gap = Math.min(pollMs * 2 ** failures, Math.max(pollMs, MAX_BACKOFF_MS)) * (0.8 + Math.random() * 0.4);
      checkTimer = setTimeout(async () => {
        if (document.visibilityState !== "hidden") await check();
        if (!stopped) scheduleCheck();
      }, gap);
    };
    void check();
    scheduleCheck();

    // Realtime failing (not the device being offline) is told to the server, once for this page.
    let reported = false;
    const fallback = () => {
      if (stopped) return;
      setStatus(navigator.onLine ? "polling" : "offline");
      if (navigator.onLine && !reported) {
        reported = true;
        reportProblem("realtime_down");
      }
    };
    // A notice of a change: refresh at once, and remember it, so the next check doesn't refresh for it again.
    const heard = (payload: { new?: { changed_at?: string } }) => {
      if (payload.new?.changed_at) seen = payload.new.changed_at;
      refresh();
    };
    // The first change makes the activity's row, later ones update it.
    const filter = `activity_id=eq.${activityId}`;
    const channel = realtime
      ? supabase
          .channel(`activity:${activityId}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_changes", filter }, heard)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activity_changes", filter }, heard)
      : null;
    channel?.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        subscribed = true;
        setStatus("live");
        refresh(); // catch anything that changed while connecting
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        subscribed = false;
        fallback();
        void check(true); // anything missed while it was failing, once the server can be reached
      }
    });
    const grace = setTimeout(() => {
      if (realtime && !subscribed) fallback();
    }, CONNECT_GRACE_MS);

    // Back in view, or back online: catch up, through a check, so a reload only happens once the server answers.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(true);
    };
    // A page restored from the back/forward cache, or a window brought back to the front.
    const onShow = () => void check(true);
    const onNetwork = () => {
      if (!navigator.onLine) setStatus("offline");
      else {
        setStatus(subscribed || !realtime ? "live" : "polling");
        failures = 0;
        void check(true);
        scheduleCheck();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);

    return () => {
      stopped = true;
      refresher.cancel();
      clearTimeout(grace);
      clearTimeout(checkTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [activityId, router, pollMs, minGapMs, realtime]);

  return status;
}
