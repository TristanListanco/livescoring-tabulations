"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRefresher, pollEvery } from "./refresh-schedule";
import { browserClient } from "./supabase/browser";

/**
 * live: realtime connected. polling: realtime unavailable (blocked or flaky Wi-Fi), so the
 * page refreshes on a timer instead. offline: the device has no network at all.
 */
export type LiveStatus = "connecting" | "live" | "polling" | "offline";

const CONNECT_GRACE_MS = 8_000;

type Options = {
  /**
   * How often to check while realtime is down (a judge waiting for approval checks more often). While realtime is
   * up, a much slower check (see pollEvery) only catches anything it missed.
   */
  pollMs?: number;
  /** At most one refresh this often: for a page many people watch at once (the public live results). */
  minGapMs?: number;
  /**
   * How often to check while realtime is up, in place of pollEvery's slower pace: for a page whose refreshes are
   * cheap (the cached live results), so a refresh that just missed a change is put right soon.
   */
  safetyPollMs?: number;
};

/**
 * Re-render the current page whenever this activity's data changes.
 * Realtime does the fast path. Polling, and refreshing whenever the page comes back into view, cover
 * connections that drop on venue Wi-Fi or while a phone's browser sits in the background (for example
 * while the camera scans a QR code). Changes arriving together make one refresh (see createRefresher).
 *
 * Realtime only says that the activity changed (activity_changes, kept up to date by database triggers on its
 * settings, judges, entries, scores and program), never what: the results tables are private, so the page reloads
 * its data from the server. Before migration 016 that table doesn't exist; realtime then reports an error and the
 * screen falls back to polling.
 */
export function useLiveRefresh(activityId: string, { pollMs = 5_000, minGapMs = 0, safetyPollMs }: Options = {}): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    let subscribed = false;
    const refresher = createRefresher(() => router.refresh(), { minGapMs });
    const refresh = refresher.request;
    // Polls at a pace that follows realtime: often while it's down, rarely while it's up.
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const schedulePoll = () => {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => {
        refresh();
        schedulePoll();
      }, subscribed && safetyPollMs ? safetyPollMs : pollEvery(pollMs, subscribed));
    };
    const fallback = () => {
      setStatus(navigator.onLine ? "polling" : "offline");
      schedulePoll();
    };

    const supabase = browserClient();
    // The first change makes the activity's row, later ones update it.
    const filter = `activity_id=eq.${activityId}`;
    const channel = supabase
      .channel(`activity:${activityId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_changes", filter }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activity_changes", filter }, refresh);
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        subscribed = true;
        setStatus("live");
        schedulePoll();
        refresh(); // catch anything that changed while connecting
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        subscribed = false;
        fallback();
        refresh(); // anything missed while it was failing
      }
    });

    const grace = setTimeout(() => {
      if (!subscribed) fallback();
    }, CONNECT_GRACE_MS);
    schedulePoll();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // A page restored from the back/forward cache, or a window brought back to the front.
    const onShow = () => refresh();
    const onNetwork = () => {
      if (!navigator.onLine) setStatus("offline");
      else {
        setStatus(subscribed ? "live" : "polling");
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);

    return () => {
      refresher.cancel();
      clearTimeout(grace);
      clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      void supabase.removeChannel(channel);
    };
  }, [activityId, router, pollMs, minGapMs, safetyPollMs]);

  return status;
}
