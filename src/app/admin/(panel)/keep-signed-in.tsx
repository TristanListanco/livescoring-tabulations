"use client";

import { useEffect } from "react";
import { keepAdminSession } from "../actions";

/** How often an open panel renews its session: it's renewed only once less than 8 of its 12 hours are left. */
const EVERY_MS = 30 * 60_000;

/**
 * Keeps the admin signed in while their panel is open and in view, so a long day (a rehearsal, then the show) doesn't
 * end the session mid-show and send the desk to the login page. Asks every half hour, and as the panel comes back into
 * view after a while; the server renews only when it's due (see renewAdminSession).
 */
export function KeepSignedIn() {
  useEffect(() => {
    // Not more than once in 10 minutes: switching tabs back and forth shouldn't make a request each time. Not as the
    // panel opens either: the page that just loaded was signed in, and each request is a function call on the host.
    let last = Date.now();
    const keep = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 10 * 60_000) return;
      last = Date.now();
      void keepAdminSession().catch(() => {});
    };
    const timer = setInterval(keep, EVERY_MS);
    document.addEventListener("visibilitychange", keep);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", keep);
    };
  }, []);
  return null;
}
