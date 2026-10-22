"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { checkInterval, createRefresher } from "./refresh-schedule";
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
/** With realtime connected, how often the page checks anyway, for a notice that never came. */
const LIVE_CHECK_MS = 20_000;
/**
 * A page out of view this long lets go of its realtime connection (a desk's other tab, a judge's tablet asleep, a
 * laptop lid closed): connections are what realtime's plan counts, at their peak. It connects again, and catches up,
 * as it comes back into view.
 */
const HIDDEN_RELEASE_MS = 60_000;

/**
 * Each channel's own name. A channel let go of stays in the client's list until the server says it has left, and a new
 * one under the same name in the meantime would be that one, leaving: it never joins, so the page would quietly lose
 * realtime (after a judge's device is approved, say, when the page starts listening again with its new timing).
 */
let channels = 0;
const channelName = (activityId: string) => `activity:${activityId}:${++channels}${Math.random().toString(36).slice(2, 8)}`;

type Options = {
  /** How often the page checks whether its activity changed without realtime (a judge waiting for approval checks more often). */
  pollMs?: number;
  /** At most one refresh this often: for a page many people watch at once (the public live results). */
  minGapMs?: number;
  /**
   * Hear changes over realtime as well as checking. Off for the audience's pages: with many activities at once their
   * phones would be most of realtime's connections, and realtime falls behind when every change has to reach hundreds
   * of them. Their checks keep them a few seconds behind at most, and cost a single row each. Off too on the desk and
   * the LED wall once judging has ended, when hardly anything changes: the checks are enough (see JUDGING_OVER).
   */
  realtime?: boolean;
  /** With realtime connected, how often to check anyway (the LED wall, on air, checks more often). */
  liveCheckMs?: number;
  /** Check less often while nothing changes, up to this (the audience's phones; see checkInterval). */
  idleMaxMs?: number;
  /** False: the page's activity can't change anymore (it's archived), so it neither checks nor listens. */
  enabled?: boolean;
};

/**
 * For an organizer's or the audience's screen once the session has ended: hardly anything changes until it's reopened
 * (or deliberated again, from the desk itself), so it lets go of realtime and checks every half minute, and at once
 * whenever it comes back into view. The judges' screens keep listening: reopening brings them straight back.
 */
export const JUDGING_OVER = { pollMs: 30_000, realtime: false } satisfies Options;

/**
 * Re-render the current page whenever this activity's data changes.
 *
 * Every few seconds the page reads its activity's last change (activity_changes: one row, kept up to date by database
 * triggers on its settings, judges, entries, scores and program) straight from the database, and refreshes only when
 * it moved: a check costs no page render, and a missed notice or a dropped connection costs seconds, not a stale
 * screen. Realtime makes it sooner: a notice of a change refreshes at once, and while it's connected the checks are
 * only a rare safety net. Refreshing whenever the page comes back into view covers a phone's browser sitting in the
 * background (for example while the camera scans a QR code). Changes arriving together make one refresh (see
 * createRefresher).
 *
 * The page never learns what changed: the results tables are private, so it reloads its data from the server. Before
 * migration 016 there's no activity_changes: realtime reports an error, and the checks fall back to refreshing.
 *
 * It only reloads once a check has just reached the server. A reload that can't reach it (the venue Wi-Fi dropped)
 * would leave the screen on an error page that never comes back by itself; instead it waits, checking less often the
 * longer checks fail (with a little randomness, so a room of screens doesn't retry in step), and catches up as soon
 * as one gets through.
 */
export function useLiveRefresh(
  activityId: string,
  { pollMs = 5_000, minGapMs = 0, realtime = true, liveCheckMs = LIVE_CHECK_MS, idleMaxMs = 0, enabled = true }: Options = {},
): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let subscribed = false;
    // The last change this page knows about: undefined until the first check, then the row's time (null: none yet).
    let seen: string | null | undefined;
    const refresher = createRefresher(() => router.refresh(), { minGapMs });
    const refresh = refresher.request;
    const supabase = browserClient();

    // Checks that failed in a row, and that found nothing new in a row: how far apart the next ones are.
    let failures = 0;
    let unchanged = 0;
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
      const moved = seen === undefined || at !== seen;
      unchanged = moved ? 0 : unchanged + 1;
      if (catchUp || moved) refresh();
      seen = at;
      if (!realtime) setStatus("live");
      return true;
    };
    // Not while the page is hidden (a phone locked in a pocket, a tab in the background): it refreshes as it comes back
    // into view anyway, and a crowd of idle phones would otherwise keep the database busy for nothing.
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleCheck = () => {
      clearTimeout(checkTimer);
      const gap = checkInterval({ pollMs, liveCheckMs, idleMaxMs, subscribed, failures, unchanged }) * (0.8 + Math.random() * 0.4);
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
      unchanged = 0;
      refresh();
    };
    // The first change makes the activity's row, later ones update it.
    const filter = `activity_id=eq.${activityId}`;
    let channel: RealtimeChannel | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (!realtime || channel) return;
      const joining = supabase
        .channel(channelName(activityId))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_changes", filter }, heard)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activity_changes", filter }, heard);
      channel = joining;
      joining.subscribe((state) => {
        // A channel this page let go of (out of view) closing isn't a failure.
        if (stopped || channel !== joining) return;
        if (state === "SUBSCRIBED") {
          subscribed = true;
          setStatus("live");
          refresh(); // catch anything that changed while connecting
          scheduleCheck();
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          subscribed = false;
          fallback();
          void check(true); // anything missed while it was failing, once the server can be reached
          scheduleCheck();
        }
      });
      clearTimeout(grace);
      grace = setTimeout(() => {
        if (channel === joining && !subscribed) fallback();
      }, CONNECT_GRACE_MS);
    };
    const release = () => {
      const leaving = channel;
      if (!leaving) return;
      channel = null;
      subscribed = false;
      clearTimeout(grace);
      void supabase.removeChannel(leaving);
    };
    connect();

    // Back in view, or back online: catch up, through a check, so a reload only happens once the server answers. Out
    // of view for a while: let go of realtime, until it's back.
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    const onVisible = () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === "visible") {
        connect();
        void check(true);
      } else if (realtime) {
        hiddenTimer = setTimeout(release, HIDDEN_RELEASE_MS);
      }
    };
    if (document.visibilityState === "hidden" && realtime) hiddenTimer = setTimeout(release, HIDDEN_RELEASE_MS);
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
      clearTimeout(hiddenTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      release();
    };
  }, [activityId, router, pollMs, minGapMs, realtime, liveCheckMs, idleMaxMs, enabled]);

  return enabled ? status : "live";
}
