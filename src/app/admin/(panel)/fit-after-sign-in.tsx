"use client";

import { useEffect } from "react";

/** Set by the sign-in form as it's sent (see LoginForm): the next panel page checks the phone isn't left zoomed in. */
export const SIGNED_IN_KEY = "tabulous:signed-in";

/**
 * On a phone, signing in can leave the panel zoomed in: iOS zooms to the field being typed in, and keeps that zoom when
 * the page changes under it, so the organizer had to pinch the dashboard back to the screen's width. The form closes the
 * keyboard as it's sent; this, on the first panel page after, eases the zoom back to fit (by capping it for a moment),
 * once, and only if the page is zoomed: anyone who zooms in on purpose afterwards keeps it.
 */
export function FitAfterSignIn() {
  useEffect(() => {
    let signedIn = false;
    try {
      signedIn = sessionStorage.getItem(SIGNED_IN_KEY) !== null;
      sessionStorage.removeItem(SIGNED_IN_KEY);
    } catch {
      return;
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!signedIn || !meta || (window.visualViewport?.scale ?? 1) <= 1.01) return;
    const was = meta.content;
    meta.content = `${was}, maximum-scale=1`;
    // Pinch-zoom comes back at once: the cap is only there long enough for the browser to fit the page.
    const restore = setTimeout(() => (meta.content = was), 400);
    return () => {
      clearTimeout(restore);
      meta.content = was;
    };
  }, []);
  return null;
}
