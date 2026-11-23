"use client";

import { useEffect, useRef, useState } from "react";

/** How long the judge's top bar stays after a tap brings it back. */
const BAR_SHOWN_MS = 3_500;
/** What a tap is meant for rather than the bar: a key, a choice, a field, a link, a dialog. */
const CONTROLS = "button, a, input, select, textarea, label, summary, dialog, [role='button']";

/**
 * Once judging is under way (`active`) the judge's top bar steps aside, so the entry and the keypad have the screen. A
 * tap anywhere that isn't a control brings it back for a few seconds, and so does a tap on the bar itself while it's
 * there; a tap on a key never does, so it can't cover the entry mid-score. Keyboard focus in the bar shows it too (in
 * CSS). Returns whether it's shown, and the handler for the screen's pointerdown.
 */
export function useBarOnTap(active: boolean) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onPointerDown = (event: React.PointerEvent) => {
    if (!active) return;
    const target = event.target as Element;
    if (!target.closest("header") && target.closest(CONTROLS)) return;
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), BAR_SHOWN_MS);
  };
  return { shown: active && shown, onPointerDown };
}

/** A tablet or a laptop, not a phone (upright or on its side). */
const BIG_SCREEN = "(min-width: 744px) and (min-height: 600px)";

/**
 * On a tablet or a laptop, once judging is under way (`active`), the judge's screen goes full screen. Browsers allow it
 * only from the judge's own tap or key, so it happens at the next one, after the tap itself has done what it was for.
 * Once per visit: a judge who leaves full screen stays out of it. Phones (whose browsers mostly can't) are left as they are.
 */
export function useFullScreenOnBigScreen(active: boolean) {
  const tried = useRef(false);
  useEffect(() => {
    if (!active || tried.current || !window.matchMedia(BIG_SCREEN).matches) return;
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const enter = (event: Event) => {
      // Escape doesn't count as the judge's gesture, and is how they'd leave it.
      if (event instanceof KeyboardEvent && event.key === "Escape") return;
      tried.current = true;
      stop();
      if (document.fullscreenElement) return;
      try {
        if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
        else root.webkitRequestFullscreen?.();
      } catch {
        // Not allowed here (an embedded view, a browser without it): the screen stays as it is.
      }
    };
    const stop = () => {
      window.removeEventListener("click", enter);
      window.removeEventListener("keydown", enter);
    };
    window.addEventListener("click", enter);
    window.addEventListener("keydown", enter);
    return stop;
  }, [active]);
}
