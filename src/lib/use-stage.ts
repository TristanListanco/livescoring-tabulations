"use client";

import { useSyncExternalStore } from "react";

/**
 * A projector or venue screen: landscape, wide and tall enough to read across a room. Nobody scrolls a projected
 * page, so there the live results fill exactly one screen and page through long lists. Phones, portrait screens
 * and short windows scroll as usual.
 */
const STAGE_QUERY = "(min-width: 64rem) and (min-height: 30rem) and (orientation: landscape)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(STAGE_QUERY);
  // Safari before 14 only has the older listener methods.
  if (!query.addEventListener) {
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether this screen is a stage. Only ever true once the page is running in the browser, so a page whose script
 * hasn't loaded keeps the ordinary scrolling layout and every row stays in reach.
 */
export function useStage() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(STAGE_QUERY).matches,
    () => false,
  );
}
