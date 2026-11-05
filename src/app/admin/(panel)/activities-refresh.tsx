"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Set when the list changed without a reload of the page (a draft saved, a pageant created): the browser's cached copy
 * is out of date, so the list reloads as it next opens.
 */
let changedSince = false;
export function listChanged() {
  changedSince = true;
}

/** As often as the list reloads itself; a list older than this, shown again from the browser's cache, reloads at once. */
const EVERY_MS = 15_000;

/**
 * Keeps the list of activities current while shows are running, for an organizer watching many rooms from it: it
 * reloads from the server every 15 seconds while the page is in view, and at once when it comes back into view.
 * `renderedAt`: when the server rendered it.
 */
export function ActivitiesRefresh({ active, renderedAt }: { active: boolean; renderedAt: number }) {
  const router = useRouter();
  useEffect(() => {
    if (changedSince) {
      changedSince = false;
      router.refresh();
    }
  }, [router]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    if (Date.now() - renderedAt > EVERY_MS) refresh();
    const timer = setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, renderedAt, router]);
  return null;
}
