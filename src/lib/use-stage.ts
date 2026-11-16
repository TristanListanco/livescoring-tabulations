"use client";

import { useSyncExternalStore } from "react";

/**
 * A projector or venue screen: landscape, wide and tall enough to read across a room, or a big screen turned upright
 * (a portrait TV or signage panel, at least 960 × 1600). Nobody scrolls a screen like that, so there the live results
 * fill exactly one screen and page through long lists. Phones, tablets, smaller portrait screens and short windows
 * scroll as usual.
 */
const STAGE_QUERY =
  "((min-width: 64rem) and (min-height: 30rem) and (orientation: landscape)), ((min-width: 60rem) and (min-height: 100rem) and (orientation: portrait))";

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
