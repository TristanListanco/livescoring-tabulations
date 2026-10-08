"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserClient } from "./supabase/browser";

/**
 * live: realtime connected. polling: realtime unavailable (blocked or flaky Wi-Fi), so the
 * page refreshes on a timer instead. offline: the device has no network at all.
 */
export type LiveStatus = "connecting" | "live" | "polling" | "offline";

const CONNECT_GRACE_MS = 8_000;

/**
 * Re-render the current page whenever this activity's data changes.
 * Realtime does the fast path. Polling, and refreshing whenever the page comes back into view, cover
 * connections that drop on venue Wi-Fi or while a phone's browser sits in the background (for example
 * while the camera scans a QR code). Screens that must react quickly, like a judge waiting for
 * approval, pass a shorter `pollMs`. Pageants pass `withRounds`, so a confirmed cut or a changed timer lands
 * right away (only pageants: databases without migration 011 have no rounds table to follow).
 */
export function useLiveRefresh(activityId: string, pollMs = 15_000, withRounds = false): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    let subscribed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    const fallback = () => setStatus(navigator.onLine ? "polling" : "offline");

    const supabase = browserClient();
    const filter = `activity_id=eq.${activityId}`;
    let channel = supabase
      .channel(`activity:${activityId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scores", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "judges", filter }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activities", filter: `id=eq.${activityId}` }, refresh)
      // Realtime cannot filter deletes, so any delete (a developer reset, a removed entry) triggers a refetch.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "scores" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "entries" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "judges" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "activities" }, refresh);
    if (withRounds) channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter }, refresh);
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        subscribed = true;
        setStatus("live");
        refresh(); // catch anything that changed while connecting
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        subscribed = false;
        fallback();
      }
    });

    const grace = setTimeout(() => {
      if (!subscribed) fallback();
    }, CONNECT_GRACE_MS);
    const poll = setInterval(refresh, pollMs);
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
      clearTimeout(timer);
      clearTimeout(grace);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      void supabase.removeChannel(channel);
    };
  }, [activityId, router, pollMs, withRounds]);

  return status;
}
