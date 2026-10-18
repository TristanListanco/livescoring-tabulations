"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the list of activities current while shows are running, for an organizer watching many rooms from it: it
 * reloads from the server every 15 seconds while the page is in view, and at once when it comes back into view.
 */
export function ActivitiesRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, router]);
  return null;
}
