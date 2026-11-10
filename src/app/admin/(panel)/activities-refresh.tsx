"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { timeoutSignal } from "@/lib/timeout-signal";

/**
 * Set when the list changed without a reload of the page (a draft saved, a pageant created): the browser's cached copy
 * is out of date, so the list reloads as it next opens.
 */
let changedSince = false;
export function listChanged() {
  changedSince = true;
}

/** As often as the list checks for changes; a list older than this, shown again from the browser's cache, reloads at once. */
const EVERY_MS = 15_000;

/**
 * Keeps the list of activities current while shows are running, for an organizer watching many rooms from it. Every 15
 * seconds while the page is in view (and as it comes back into view) it reads when each running activity last changed
 * (activity_changes, straight from the database, as the judges' screens do) and reloads only when one moved: a
 * reload is a page render on the server, and a list left open all day otherwise rendered four times a minute for
 * nothing. `watch`: the activities still running. `renderedAt`: when the server rendered it.
 */
export function ActivitiesRefresh({ watch, renderedAt }: { watch: string[]; renderedAt: number }) {
  const router = useRouter();
  useEffect(() => {
    if (changedSince) {
      changedSince = false;
      router.refresh();
    }
  }, [router]);
  const key = watch.join(",");
  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    if (Date.now() - renderedAt > EVERY_MS) router.refresh();
    // What the list last saw: each activity's last change, in one string. Unset until the first check.
    let seen: string | undefined;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await browserClient()
        .from("activity_changes")
        .select("activity_id, changed_at")
        .in("activity_id", ids)
        .abortSignal(timeoutSignal(8_000));
      // Unreachable for now: the next check tries again.
      if (stopped || error) return;
      const now = (data as { activity_id: string; changed_at: string }[])
        .map((r) => `${r.activity_id}:${r.changed_at}`)
        .sort()
        .join("|");
      if (seen !== undefined && now !== seen) router.refresh();
      seen = now;
    };
    void check();
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [key, renderedAt, router]);
  return null;
}
