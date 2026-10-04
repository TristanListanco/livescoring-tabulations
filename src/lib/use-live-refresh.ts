"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserClient } from "./supabase/browser";

/**
 * live: realtime connected. polling: realtime unavailable (blocked or flaky Wi-Fi), so the
 * page refreshes on a timer instead. offline: the device has no network at all.
 */
export type LiveStatus = "connecting" | "live" | "polling" | "offline";

const POLL_MS = 15_000;
const CONNECT_GRACE_MS = 8_000;

/**
 * Re-render the current page whenever this activity's data changes.
 * Realtime does the fast path; polling and tab focus cover dropped connections on venue Wi-Fi.
 */
export function useLiveRefresh(activityId: string): LiveStatus {
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
    const channel = supabase
      .channel(`activity:${activityId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scores", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "judges", filter }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "activities", filter: `id=eq.${activityId}` }, refresh)
      // Realtime cannot filter deletes, so any delete (a developer reset, a removed entry) triggers a refetch.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "scores" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "entries" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "judges" }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "activities" }, refresh)
      .subscribe((state) => {
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
    const poll = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onNetwork = () => {
      if (!navigator.onLine) setStatus("offline");
      else {
        setStatus(subscribed ? "live" : "polling");
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);

    return () => {
      clearTimeout(timer);
      clearTimeout(grace);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      void supabase.removeChannel(channel);
    };
  }, [activityId, router]);

  return status;
}
