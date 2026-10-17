"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRefresher } from "./refresh-schedule";
import { browserClient } from "./supabase/browser";

/**
 * live: keeping up (realtime connected, or the page's checks are answering). polling: realtime unavailable (blocked or
 * flaky Wi-Fi), so the page checks on a timer instead. offline: the device has no network at all.
 */
export type LiveStatus = "connecting" | "live" | "polling" | "offline";

const CONNECT_GRACE_MS = 8_000;

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

    const check = async () => {
      const { data, error } = await supabase.from("activity_changes").select("changed_at").eq("activity_id", activityId).maybeSingle();
      if (stopped) return;
      if (error) {
        // Unreadable (before migration 016, or the request failed): without realtime, refresh instead.
        if (!subscribed) {
          setStatus(navigator.onLine ? "polling" : "offline");
          refresh();
        }
        return;
      }
      const at = (data as { changed_at: string } | null)?.changed_at ?? null;
      // The first check can't tell whether a change came between the server rendering this page and now (the time it
      // took to load and start up), so it catches up once; after that, only a change does.
      if (seen === undefined || at !== seen) refresh();
      seen = at;
      if (!realtime) setStatus("live");
    };
    // Not while the page is hidden (a phone locked in a pocket, a tab in the background): it refreshes as it comes back
    // into view anyway, and a crowd of idle phones would otherwise keep the database busy for nothing.
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleCheck = () => {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(async () => {
        if (document.visibilityState !== "hidden") await check();
        if (!stopped) scheduleCheck();
      }, pollMs);
    };
    void check();
    scheduleCheck();

    const fallback = () => {
      if (!stopped) setStatus(navigator.onLine ? "polling" : "offline");
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
        refresh(); // anything missed while it was failing
      }
    });
    const grace = setTimeout(() => {
      if (realtime && !subscribed) fallback();
    }, CONNECT_GRACE_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // A page restored from the back/forward cache, or a window brought back to the front.
    const onShow = () => refresh();
    const onNetwork = () => {
      if (!navigator.onLine) setStatus("offline");
      else {
        setStatus(subscribed || !realtime ? "live" : "polling");
        refresh();
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
